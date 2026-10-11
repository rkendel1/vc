/**
 * Backup, restore and verification for the FeltDB file directory and the private document directory.
 *
 * What is and is not guaranteed (see docs/invest/PRODUCTION_READINESS.md):
 *  - A FeltDB directory is a snapshot plus a journal that a running server rewrites. Copying it is only safe if nothing wrote
 *    while we copied. We cannot freeze the writer, so backup DETECTS change instead: it records every file's size and mtime before
 *    and after the copy and aborts (retrying a bounded number of times) if anything differs. The sound way to get a guaranteed
 *    backup is to stop the server first; "detect and abort" is the safety net when you did not.
 *  - A backup holds only the database directory and, optionally, the document directory. It never reads the identity registry, the
 *    environment, the link secret or API keys, so a data archive carries no credentials.
 *  - Restore never writes into a directory that already has anything in it, and never into a directory the live server is configured to use.
 */
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { DocumentStorage } from "../../ingestion/document-storage.ts";
import { C, InvestStore } from "../../store/store.ts";

export class DataSafetyError extends Error {}

type FileEntry = { path: string; size: number; sha256: string };
export type Manifest = {
	format: 1;
	createdAt: string;
	database: FileEntry[];
	documents: { included: boolean; files: FileEntry[] };
	counts: Record<string, number>;
	notes: string[];
};

const sha256File = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");

async function listFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	const walk = async (dir: string) => {
		for (const e of await readdir(dir, { withFileTypes: true })) {
			const full = join(dir, e.name);
			if (e.isDirectory()) await walk(full);
			else if (e.isFile()) out.push(relative(root, full));
		}
	};
	await walk(root);
	return out.sort();
}

/** Size and mtime of every file except the writer's lock, which comes and goes. */
async function signature(root: string): Promise<string> {
	const rows: string[] = [];
	for (const rel of await listFiles(root)) {
		if (basename(rel) === "state.lock") continue;
		const st = await stat(join(root, rel));
		rows.push(`${rel}:${st.size}:${st.mtimeMs}`);
	}
	return rows.join("\n");
}

/** Is another process holding the FeltDB writer lock right now? */
export async function liveWriter(feltDir: string): Promise<number | null> {
	try {
		const raw = JSON.parse(await readFile(join(feltDir, "state.lock"), "utf8")) as { pid?: number };
		if (typeof raw.pid !== "number") return null;
		process.kill(raw.pid, 0);
		return raw.pid;
	} catch {
		return null;
	}
}

async function entries(root: string): Promise<FileEntry[]> {
	const out: FileEntry[] = [];
	for (const rel of await listFiles(root)) {
		if (basename(rel) === "state.lock") continue;
		const full = join(root, rel);
		out.push({ path: rel, size: (await stat(full)).size, sha256: await sha256File(full) });
	}
	return out;
}

/**
 * FeltDB answers an unreadable snapshot by trying state.json.backup and, if that fails too, by "reinitializing state", i.e. silently
 * starting EMPTY. That is the right call for a library and the wrong one for an operator, so we look at the snapshot ourselves, without
 * opening (and therefore without modifying) the directory.
 */
export async function snapshotProblems(feltDir: string): Promise<string[]> {
	const names = await readdir(feltDir).catch(() => [] as string[]);
	if (!names.length) return [];
	const problems: string[] = [];
	for (const name of ["state.json"]) {
		if (!names.includes(name)) {
			problems.push(`${name} is missing from a non-empty database directory`);
			continue;
		}
		try {
			JSON.parse(await readFile(join(feltDir, name), "utf8"));
		} catch {
			problems.push(`${name} is not valid JSON; FeltDB would fall back to state.json.backup or silently start empty. Restore from a backup`);
		}
	}
	return problems;
}

export type VerifyReport = { ok: boolean; problems: string[]; counts: Record<string, number> };

/** Opens the directory with the real store and checks what the application relies on. Run it on a copy, or with the server stopped. */
export async function verifyData(options: { feltDir: string; documentsDir?: string }): Promise<VerifyReport> {
	const problems: string[] = [];
	const counts: Record<string, number> = {};
	const exists = await stat(options.feltDir).then((s) => s.isDirectory(), () => false);
	if (!exists) return { ok: false, problems: ["database directory does not exist"], counts };
	const pid = await liveWriter(options.feltDir);
	if (pid) return { ok: false, problems: [`database directory is in use by process ${pid}; verify a backup or restored copy, or stop the server`], counts };
	const snapshot = await snapshotProblems(options.feltDir);
	if (snapshot.length) return { ok: false, problems: snapshot, counts };
	let store: InvestStore;
	try {
		store = await InvestStore.openDir(options.feltDir);
	} catch (error) {
		return { ok: false, problems: [`database cannot be opened: ${String(error).slice(0, 200)}`], counts };
	}
	try {
		const all: Record<string, Record<string, unknown>[]> = {};
		for (const [key, name] of Object.entries(C)) {
			all[key] = await store.scanAll<Record<string, unknown>>(name);
			counts[name] = all[key]!.length;
		}
		const ids = (key: string) => new Set(all[key]!.map((r) => r.id as string));
		const refs: [string, string, string][] = [
			["evaluations", "startupId", "startups"],
			["decisions", "evaluationId", "evaluations"],
			["findings", "evaluationId", "evaluations"],
			["claimEvents", "claimId", "representativeClaims"],
			["documents", "startupId", "startups"],
		];
		for (const [from, field, to] of refs) {
			const known = ids(to);
			const dangling = all[from]!.filter((r) => typeof r[field] === "string" && !known.has(r[field] as string));
			if (dangling.length) problems.push(`${dangling.length} ${from} record(s) point at a missing ${to} record (${field})`);
		}
		for (const e of all.audit!) if (typeof e.eventType !== "string" || typeof e.timestamp !== "string" || typeof e.workspaceId !== "string") problems.push(`audit event ${String(e.id)} is malformed`);
		if (options.documentsDir) {
			const storage = new DocumentStorage(options.documentsDir, "verification-only-secret");
			for (const d of all.documents!) {
				if (!d.storageRef || d.purgedAt) continue;
				try {
					const bytes = await storage.read(d.workspaceId as string, d.storageRef as string);
					if (createHash("sha256").update(bytes).digest("hex") !== d.contentHash) problems.push(`document ${String(d.id)} content does not match its recorded hash`);
				} catch {
					problems.push(`document ${String(d.id)} original is missing from the document directory`);
				}
			}
		}
	} finally {
		await store.close();
	}
	return { ok: problems.length === 0, problems, counts };
}

async function copyTree(from: string, to: string) {
	await cp(from, to, { recursive: true, filter: (src) => basename(src) !== "state.lock" });
}

export async function backupData(options: { feltDir: string; documentsDir?: string; outRoot: string; now?: () => Date; attempts?: number; afterCopy?: () => Promise<void> | void }): Promise<{ dir: string; manifest: Manifest }> {
	const now = (options.now ?? (() => new Date()))();
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const finalDir = join(options.outRoot, `invest-backup-${stamp}`);
	if (await stat(finalDir).then(() => true, () => false)) throw new DataSafetyError(`${finalDir} already exists; backups are never overwritten`);
	if (!(await stat(options.feltDir).then((s) => s.isDirectory(), () => false))) throw new DataSafetyError("database directory does not exist");
	await mkdir(options.outRoot, { recursive: true, mode: 0o700 });
	const partial = join(options.outRoot, `.partial-${stamp}-${process.pid}`);
	const attempts = options.attempts ?? 3;
	try {
		let copied = false;
		for (let i = 0; i < attempts && !copied; i++) {
			await rm(partial, { recursive: true, force: true });
			await mkdir(partial, { recursive: true, mode: 0o700 });
			const before = await signature(options.feltDir);
			const docBefore = options.documentsDir ? await signature(options.documentsDir) : "";
			await copyTree(options.feltDir, join(partial, "database"));
			if (options.documentsDir) await copyTree(options.documentsDir, join(partial, "documents"));
			await options.afterCopy?.();
			const after = await signature(options.feltDir);
			const docAfter = options.documentsDir ? await signature(options.documentsDir) : "";
			copied = before === after && docBefore === docAfter;
		}
		if (!copied) throw new DataSafetyError(`the data changed while it was being copied (${attempts} attempts). Stop the server (or wait for a quiet moment) and run the backup again; nothing was kept`);
		// Verify on a scratch copy so opening the database cannot alter the backup itself.
		const scratch = await mkdtemp(join(tmpdir(), "invest-verify-"));
		try {
			await copyTree(join(partial, "database"), join(scratch, "database"));
			if (options.documentsDir) await copyTree(join(partial, "documents"), join(scratch, "documents"));
			const report = await verifyData({ feltDir: join(scratch, "database"), documentsDir: options.documentsDir ? join(scratch, "documents") : undefined });
			if (!report.ok) throw new DataSafetyError(`the copied data failed verification: ${report.problems.join("; ")}`);
			const manifest: Manifest = {
				format: 1,
				createdAt: now.toISOString(),
				database: await entries(join(partial, "database")),
				documents: { included: !!options.documentsDir, files: options.documentsDir ? await entries(join(partial, "documents")) : [] },
				counts: report.counts,
				notes: ["Contains the database directory and, if included, original documents. Contains no identity registry, environment or secrets.", "Restore only into an empty directory with `bun run restore`."],
			};
			await writeFile(join(partial, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
			await rename(partial, finalDir);
			return { dir: finalDir, manifest };
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	} catch (error) {
		await rm(partial, { recursive: true, force: true });
		throw error;
	}
}

export async function readManifest(backupDir: string): Promise<Manifest> {
	try {
		const m = JSON.parse(await readFile(join(backupDir, "manifest.json"), "utf8")) as Manifest;
		if (m.format !== 1 || !Array.isArray(m.database)) throw new Error("unsupported");
		return m;
	} catch {
		throw new DataSafetyError("manifest.json is missing or unreadable; this is not a complete backup");
	}
}

/** Every file in the backup is present, the right size and the right hash, and nothing extra is there. */
export async function verifyBackup(backupDir: string): Promise<{ ok: boolean; problems: string[]; manifest: Manifest }> {
	const manifest = await readManifest(backupDir);
	const problems: string[] = [];
	const check = async (sub: string, files: FileEntry[]) => {
		const present = new Set<string>();
		const root = join(backupDir, sub);
		const found = await stat(root).then(() => listFiles(root), () => [] as string[]);
		for (const f of found) present.add(f);
		for (const f of files) {
			if (!present.has(f.path)) {
				problems.push(`${sub}/${f.path} is missing`);
				continue;
			}
			if ((await sha256File(join(root, f.path))) !== f.sha256) problems.push(`${sub}/${f.path} does not match its recorded hash (corrupted or altered)`);
			present.delete(f.path);
		}
		for (const extra of present) problems.push(`${sub}/${extra} is not in the manifest`);
	};
	await check("database", manifest.database);
	if (manifest.documents.included) await check("documents", manifest.documents.files);
	return { ok: problems.length === 0, problems, manifest };
}

async function assertEmptyTarget(target: string, live: string[]) {
	const resolved = resolve(target);
	for (const l of live) if (l && resolve(l) === resolved) throw new DataSafetyError(`${target} is the directory the server is configured to use; restore goes to a new directory`);
	const st = await stat(target).catch(() => null);
	if (!st) return;
	if (!st.isDirectory()) throw new DataSafetyError(`${target} exists and is not a directory`);
	if ((await readdir(target)).length) throw new DataSafetyError(`${target} is not empty; restore never overwrites existing data`);
}

/** Restores into new, empty directories, then re-opens and counts what it restored. The live data is never touched. */
export async function restoreBackup(options: { backupDir: string; feltTarget: string; documentsTarget?: string; liveDirs?: string[] }): Promise<{ counts: Record<string, number> }> {
	const live = options.liveDirs ?? [];
	await assertEmptyTarget(options.feltTarget, live);
	if (options.documentsTarget) await assertEmptyTarget(options.documentsTarget, live);
	const report = await verifyBackup(options.backupDir);
	if (!report.ok) throw new DataSafetyError(`backup failed verification, nothing restored: ${report.problems.join("; ")}`);
	if (options.documentsTarget && !report.manifest.documents.included) throw new DataSafetyError("this backup has no documents; omit the documents target");
	const created: string[] = [];
	try {
		await mkdir(options.feltTarget, { recursive: true, mode: 0o700 });
		created.push(options.feltTarget);
		await cp(join(options.backupDir, "database"), options.feltTarget, { recursive: true });
		if (options.documentsTarget) {
			await mkdir(options.documentsTarget, { recursive: true, mode: 0o700 });
			created.push(options.documentsTarget);
			await cp(join(options.backupDir, "documents"), options.documentsTarget, { recursive: true });
		}
		const after = await verifyData({ feltDir: options.feltTarget, documentsDir: options.documentsTarget });
		if (!after.ok) throw new DataSafetyError(`restored data failed verification: ${after.problems.join("; ")}`);
		for (const [name, n] of Object.entries(report.manifest.counts)) if ((after.counts[name] ?? 0) !== n) throw new DataSafetyError(`restored ${name} count ${after.counts[name]} does not match the backup (${n})`);
		return { counts: after.counts };
	} catch (error) {
		// Only directories this call created (and which were empty) are removed.
		for (const dir of created) await rm(dir, { recursive: true, force: true });
		throw error;
	}
}
