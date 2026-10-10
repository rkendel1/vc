import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Destination policy for research fetches. Nothing local, private, link-local, multicast,
 * reserved or otherwise non-public may be contacted, whatever a page, redirect or DNS answer says.
 * Every redirect hop is checked again.
 */

export function isPublicIPv4(ip: string): boolean {
	const p = ip.split(".").map(Number);
	if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
	const [a, b, c] = p as [number, number, number, number];
	if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
	if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
	if (a === 169 && b === 254) return false;
	if (a === 172 && b >= 16 && b <= 31) return false;
	if (a === 192 && b === 168) return false;
	if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
	if (a === 192 && b === 88 && c === 99) return false;
	if (a === 198 && (b === 18 || b === 19)) return false;
	if (a === 198 && b === 51 && c === 100) return false;
	if (a === 203 && b === 0 && c === 113) return false;
	return true;
}

function expandIPv6(ip: string): number[] | null {
	let text = ip.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
	const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
	if (v4) {
		const o = v4[1]!.split(".").map(Number);
		if (o.length !== 4 || o.some((n) => n > 255)) return null;
		text = text.slice(0, -v4[1]!.length) + ((o[0]! << 8) | o[1]!).toString(16) + ":" + ((o[2]! << 8) | o[3]!).toString(16);
	}
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(":") : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
	const missing = 8 - head.length - tail.length;
	if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
	const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
	if (groups.length !== 8) return null;
	const out = groups.map((g) => Number.parseInt(g, 16));
	return out.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff) ? null : out;
}

export function isPublicIPv6(ip: string): boolean {
	const g = expandIPv6(ip);
	if (!g) return false;
	const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
	if (g.every((n) => n === 0)) return false; // ::
	if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return false; // ::1
	if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return isPublicIPv4(embeddedV4(g[6]!, g[7]!)); // ::ffff:a.b.c.d
	if (g.slice(0, 6).every((n) => n === 0)) return false; // IPv4-compatible
	if (g[0] === 0x64 && g[1] === 0xff9b) return isPublicIPv4(embeddedV4(g[6]!, g[7]!)); // NAT64
	if (g[0] === 0x2002) return isPublicIPv4(embeddedV4(g[1]!, g[2]!)); // 6to4
	const first = g[0]!;
	if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
	if ((first & 0xffc0) === 0xfe80) return false; // link-local
	if ((first & 0xffc0) === 0xfec0) return false; // site-local
	if ((first & 0xff00) === 0xff00) return false; // multicast
	if (first === 0x2001 && g[1] === 0x0db8) return false; // documentation
	if (first === 0x2001 && g[1] === 0) return false; // Teredo
	return true;
}

export function isPublicIp(ip: string): boolean {
	const family = isIP(ip.replace(/^\[|\]$/g, ""));
	return family === 4 ? isPublicIPv4(ip) : family === 6 ? isPublicIPv6(ip) : false;
}

const BLOCKED_NAME = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|test|invalid|example)$/i;

export type Resolver = (host: string) => Promise<string[]>;
export const systemResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export class NetworkPolicyError extends Error {}

export type GuardOptions = { allowedPorts: number[]; resolve: Resolver };
export const DEFAULT_PORTS = [80, 443];

/** Throws NetworkPolicyError unless the URL names a public destination on an allowed port. */
export async function assertPublicDestination(url: URL, options: GuardOptions): Promise<void> {
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new NetworkPolicyError(`scheme ${url.protocol} is not allowed`);
	if (url.username || url.password) throw new NetworkPolicyError("credentials in URLs are not allowed");
	const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
	if (!options.allowedPorts.includes(port)) throw new NetworkPolicyError(`port ${port} is not allowed`);
	const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
	if (!host) throw new NetworkPolicyError("empty host");
	if (isIP(host)) {
		if (!isPublicIp(host)) throw new NetworkPolicyError(`${host} is not a public address`);
		return;
	}
	if (BLOCKED_NAME.test(host) || !host.includes(".")) throw new NetworkPolicyError(`${host} is not a public host name`);
	let addresses: string[];
	try {
		addresses = await options.resolve(host);
	} catch (error) {
		throw Object.assign(new NetworkPolicyError(`${host} did not resolve`), { dns: true, cause: error });
	}
	if (!addresses.length) throw Object.assign(new NetworkPolicyError(`${host} did not resolve`), { dns: true });
	const bad = addresses.find((a) => !isPublicIp(a));
	if (bad) throw new NetworkPolicyError(`${host} resolves to a non-public address (${bad})`);
}
