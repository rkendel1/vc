import { createHmac, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex } from "../domain/canonical.ts";

/**
 * Private document storage: content-addressed files under a directory only the server can read
 * (0700 directories, 0600 files), partitioned per workspace. Originals are never served directly;
 * a reader gets a short-lived HMAC-signed link that names one document in one workspace.
 */
export class DocumentStorage {
	constructor(
		private readonly root: string,
		private readonly linkSecret: string,
		private readonly linkTtlMs = 5 * 60_000,
	) {
		if (linkSecret.length < 16) throw new Error("DOCUMENT_STORAGE_LINK_SECRET must be at least 16 characters");
	}

	private dirFor(workspaceId: string): string {
		return join(this.root, sha256Hex(`ws:${workspaceId}`).slice(0, 32));
	}

	async put(workspaceId: string, contentHash: string, bytes: Uint8Array): Promise<string> {
		if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("invalid content hash");
		const dir = this.dirFor(workspaceId);
		await mkdir(dir, { recursive: true, mode: 0o700 });
		const path = join(dir, contentHash);
		const exists = await stat(path).then(
			() => true,
			() => false,
		);
		if (!exists) {
			await writeFile(path, bytes, { mode: 0o600, flag: "wx" }).catch((e: NodeJS.ErrnoException) => {
				if (e.code !== "EEXIST") throw e;
			});
			await chmod(path, 0o600);
		}
		return `local:${contentHash}`;
	}

	async read(workspaceId: string, storageRef: string): Promise<Uint8Array> {
		const hash = this.hashOf(storageRef);
		return new Uint8Array(await readFile(join(this.dirFor(workspaceId), hash)));
	}

	async remove(workspaceId: string, storageRef: string): Promise<void> {
		await rm(join(this.dirFor(workspaceId), this.hashOf(storageRef)), { force: true });
	}

	private hashOf(storageRef: string): string {
		const hash = storageRef.startsWith("local:") ? storageRef.slice(6) : "";
		if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("invalid storage reference");
		return hash;
	}

	/** A signed token naming one document in one workspace, valid for a few minutes. */
	signLink(payload: { workspaceId: string; documentId: string; storageRef: string; page?: number }, now = Date.now()): { token: string; expiresAt: string } {
		const exp = now + this.linkTtlMs;
		const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
		const sig = createHmac("sha256", this.linkSecret).update(body).digest("base64url");
		return { token: `${body}.${sig}`, expiresAt: new Date(exp).toISOString() };
	}

	verifyLink(token: string, now = Date.now()): { workspaceId: string; documentId: string; storageRef: string } | null {
		const [body, sig] = token.split(".");
		if (!body || !sig) return null;
		const expected = createHmac("sha256", this.linkSecret).update(body).digest();
		const given = Buffer.from(sig, "base64url");
		if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
		try {
			const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
			if (typeof payload.exp !== "number" || payload.exp < now) return null;
			if (typeof payload.workspaceId !== "string" || typeof payload.documentId !== "string" || typeof payload.storageRef !== "string") return null;
			return { workspaceId: payload.workspaceId, documentId: payload.documentId, storageRef: payload.storageRef };
		} catch {
			return null;
		}
	}
}
