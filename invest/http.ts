import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { HttpBinding } from "@appport/server";
import { envelopeLimit } from "./appport/server.ts";
import type { InvestRuntime } from "./bootstrap.ts";
import type { DocumentRecord } from "./domain/types.ts";
import type { Logger } from "./logger.ts";
import { C } from "./store/store.ts";

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".png": "image/png",
	".json": "application/json",
	".woff2": "font/woff2",
};

const SECURITY_HEADERS = {
	"x-content-type-options": "nosniff",
	"referrer-policy": "no-referrer",
	"x-frame-options": "SAMEORIGIN",
	"cross-origin-opener-policy": "same-origin",
	"permissions-policy": "camera=(), microphone=(), geolocation=()",
};
const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; connect-src 'self'";

function originHost(origin: string): string | undefined {
	try {
		return new URL(origin).host;
	} catch {
		return undefined;
	}
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		// Past the limit the rest of the body is drained and discarded, so the client still gets a 413.
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size <= limit) chunks.push(chunk);
		});
		req.on("end", () => (size > limit ? reject(Object.assign(new Error("payload too large"), { status: 413 })) : resolve(Buffer.concat(chunks).toString("utf8"))));
		req.on("error", reject);
	});
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
	res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...SECURITY_HEADERS, ...headers });
	res.end(JSON.stringify(body));
}

/**
 * One HTTP server: the AppPort binding (the only application API), signed original-file links,
 * and the built web app. Same-origin only for writes; no wildcard CORS on anything.
 */
export function createInvestHttpServer(runtime: InvestRuntime, options: { webDist: string; logger: Logger }): Server {
	const binding = new HttpBinding({ server: runtime.appport, statusMode: "mapped", maxBodyBytes: envelopeLimit(runtime.config.documents.maxBytes) });
	const bodyLimit = envelopeLimit(runtime.config.documents.maxBytes);
	const webRoot = normalize(options.webDist);

	return createServer(async (req, res) => {
		const url = new URL(req.url || "/", "http://localhost");
		const path = url.pathname;
		try {
			const origin = req.headers.origin;
			if (req.method !== "GET" && req.method !== "HEAD" && origin && originHost(origin) !== req.headers.host)
				return send(res, 403, { error: { code: "FORBIDDEN", message: "Cross-origin writes are not allowed" } });
			if (req.method === "OPTIONS") return send(res, 403, { error: { code: "FORBIDDEN", message: "CORS is not offered" } });

			if (path === "/healthz") return send(res, 200, { status: "ok" });

			if (binding.handles(path)) {
				const body = req.method === "POST" ? await readBody(req, bodyLimit) : undefined;
				const outcome = await binding.route({ method: req.method || "GET", path, query: url.searchParams, headers: req.headers as Record<string, string>, body });
				res.writeHead(outcome.status, { ...outcome.headers, ...SECURITY_HEADERS, "cache-control": "no-store" });
				if (outcome.kind === "json") res.end(JSON.stringify(outcome.body));
				else if (outcome.kind === "text") res.end(outcome.body);
				else {
					for await (const frame of outcome.frames) res.write(frame);
					res.end();
				}
				return;
			}

			if (path.startsWith("/files/")) {
				const claims = runtime.storage.verifyLink(decodeURIComponent(path.slice("/files/".length)));
				if (!claims) return send(res, 404, { error: { code: "NOT_FOUND", message: "Link expired or invalid" } });
				const doc = await runtime.store.get<DocumentRecord>(C.documents, claims.documentId, claims.workspaceId);
				if (!doc || doc.purgedAt || doc.storageRef !== claims.storageRef) return send(res, 404, { error: { code: "NOT_FOUND", message: "Document unavailable" } });
				const bytes = await runtime.storage.read(claims.workspaceId, claims.storageRef);
				res.writeHead(200, {
					...SECURITY_HEADERS,
					"content-type": "application/pdf",
					"content-length": String(bytes.byteLength),
					"content-disposition": `inline; filename="${doc.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
					"content-security-policy": "sandbox; default-src 'none'; object-src 'self'",
					"cache-control": "private, no-store",
				});
				res.end(Buffer.from(bytes));
				return;
			}

			if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Not allowed" } });
			let file = normalize(join(webRoot, path));
			if (!file.startsWith(webRoot)) return send(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
			const isFile = await stat(file).then(
				(s) => s.isFile(),
				() => false,
			);
			if (!isFile) file = join(webRoot, "index.html");
			const exists = await stat(file).then(
				() => true,
				() => false,
			);
			if (!exists) return send(res, 503, { error: { code: "UNAVAILABLE", message: "The web app is not built; run bun run build:invest-web" } });
			res.writeHead(200, {
				...SECURITY_HEADERS,
				"content-type": MIME[extname(file)] ?? "application/octet-stream",
				"content-security-policy": APP_CSP,
				"cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
			});
			createReadStream(file).pipe(res);
		} catch (error) {
			const status = (error as { status?: number }).status ?? 500;
			if (status === 500) options.logger.error("request failed", { path, error: String(error) });
			if (!res.headersSent) send(res, status, { error: { code: status === 413 ? "PAYLOAD_TOO_LARGE" : "INTERNAL", message: status === 413 ? "Request too large" : "Internal error" } });
			else res.end();
		}
	});
}
