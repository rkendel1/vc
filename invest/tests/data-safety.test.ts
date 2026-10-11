import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { cp, utimes, mkdir, mkdtemp, readFile, readdir, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStorage } from "../ingestion/document-storage.ts";
import { DataSafetyError, backupData, restoreBackup, verifyBackup, verifyData } from "../scripts/lib/data-safety.ts";
import { C, InvestStore } from "../store/store.ts";

const dirs: string[] = [];
afterEach(async () => {
	for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const tmp = async () => {
	const d = await mkdtemp(join(tmpdir(), "invest-ds-"));
	dirs.push(d);
	return d;
};
const actor = { principalId: "p", workspaceId: "ws-a" };

/** A small real database plus one stored original, closed cleanly. */
async function seeded() {
	const root = await tmp();
	const felt = join(root, "felt");
	const docs = join(root, "docs");
	const store = await InvestStore.openDir(felt);
	const storage = new DocumentStorage(docs, "test-link-secret-0123456789");
	const bytes = new TextEncoder().encode("%PDF- original deck bytes");
	const hash = createHash("sha256").update(bytes).digest("hex");
	const storageRef = await storage.put("ws-a", hash, bytes);
	await store.commit(actor, {
		writes: [
			{ collection: C.startups, id: "su_1", create: true, value: { workspaceId: "ws-a", name: "Northwind" } },
			{ collection: C.documents, id: "doc_1", create: true, value: { workspaceId: "ws-a", startupId: "su_1", contentHash: hash, storageRef, purgedAt: null } },
		],
		audit: [{ eventType: "startup.created", entityRef: { type: "startup", id: "su_1" } }],
	});
	await store.close();
	return { root, felt, docs, hash, bytes };
}

describe("backup", () => {
	it("round-trips: backup, verify, restore into a new directory, reopen, same records and originals", async () => {
		const s = await seeded();
		const { dir, manifest } = await backupData({ feltDir: s.felt, documentsDir: s.docs, outRoot: join(s.root, "backups") });
		expect(manifest.counts[C.startups]).toBe(1);
		expect(manifest.documents.files).toHaveLength(1);
		expect((await verifyBackup(dir)).ok).toBe(true);
		const out = await restoreBackup({ backupDir: dir, feltTarget: join(s.root, "r-felt"), documentsTarget: join(s.root, "r-docs") });
		expect(out.counts[C.documents]).toBe(1);
		const store = await InvestStore.openDir(join(s.root, "r-felt"));
		expect((await store.get<{ name: string }>(C.startups, "su_1", "ws-a"))?.name).toBe("Northwind");
		expect(await store.list(C.audit, "ws-a")).toHaveLength(1);
		await store.close();
		expect(Buffer.from(await new DocumentStorage(join(s.root, "r-docs"), "test-link-secret-0123456789").read("ws-a", `local:${s.hash}`))).toEqual(Buffer.from(s.bytes));
		// The source was not modified by backup or restore.
		expect((await verifyData({ feltDir: s.felt, documentsDir: s.docs })).ok).toBe(true);
	});

	it("never overwrites an existing backup, and carries no secrets or registry", async () => {
		const s = await seeded();
		await writeFile(join(s.root, "auth.json"), JSON.stringify({ principals: [{ tokenSha256: "deadbeef".repeat(8) }] }));
		await writeFile(join(s.root, ".env"), "JEV_API_KEY=sk-super-secret\nDOCUMENT_STORAGE_LINK_SECRET=link-secret-value-12345\n");
		const now = () => new Date("2026-10-11T10:00:00Z");
		const { dir } = await backupData({ feltDir: s.felt, outRoot: join(s.root, "backups"), now });
		await expect(backupData({ feltDir: s.felt, outRoot: join(s.root, "backups"), now })).rejects.toThrow(/never overwritten/);
		for (const f of await readdir(dir, { recursive: true })) {
			const full = join(dir, f);
			if ((await stat(full)).isFile()) {
				const text = (await readFile(full)).toString("latin1");
				for (const needle of ["sk-super-secret", "link-secret-value", "deadbeef", "tokenSha256"]) expect(text).not.toContain(needle);
			}
		}
		expect((await verifyBackup(dir)).manifest.documents.included).toBe(false);
	});

	it("aborts, keeping nothing, when the data changes while it is being copied; succeeds when the change settles", async () => {
		const s = await seeded();
		const out = join(s.root, "backups");
		let tick = 0;
		await expect(
			backupData({
				feltDir: s.felt,
				outRoot: out,
				attempts: 2,
				afterCopy: async () => {
					await utimes(join(s.felt, "state.json"), new Date(), new Date(Date.now() + 1000 * ++tick));
				},
			}),
		).rejects.toThrow(/changed while it was being copied/);
		expect((await readdir(out)).filter((n) => n.startsWith("invest-backup-") || n.startsWith(".partial"))).toHaveLength(0);
		let n = 0;
		const ok = await backupData({ feltDir: s.felt, outRoot: out, attempts: 3, afterCopy: async () => void (n++ === 0 && (await utimes(join(s.felt, "state.json"), new Date(), new Date(Date.now() + 5000)))) });
		expect((await verifyBackup(ok.dir)).ok).toBe(true);
	});

	it("refuses a missing source", async () => {
		const root = await tmp();
		await expect(backupData({ feltDir: join(root, "nope"), outRoot: root })).rejects.toThrow(DataSafetyError);
	});
});

describe("restore and verification refuse unsafe or damaged inputs", () => {
	it("a corrupted, truncated, missing or extra file in a backup stops the restore before anything is written", async () => {
		const s = await seeded();
		const { dir } = await backupData({ feltDir: s.felt, documentsDir: s.docs, outRoot: join(s.root, "b") });
		const journal = (await readdir(join(dir, "database"))).find((f) => f.endsWith(".journal"))!;
		const target = join(s.root, "t");
		// flipped bytes
		const original = await readFile(join(dir, "database", journal));
		await writeFile(join(dir, "database", journal), Buffer.concat([Buffer.from("X"), original.subarray(1)]));
		await expect(restoreBackup({ backupDir: dir, feltTarget: target })).rejects.toThrow(/does not match its recorded hash/);
		// truncated
		await writeFile(join(dir, "database", journal), original);
		await truncate(join(dir, "database", journal), 10);
		expect((await verifyBackup(dir)).ok).toBe(false);
		// missing
		await rm(join(dir, "database", journal));
		await expect(restoreBackup({ backupDir: dir, feltTarget: target })).rejects.toThrow(/is missing/);
		// manifest gone
		await rm(join(dir, "manifest.json"));
		await expect(restoreBackup({ backupDir: dir, feltTarget: target })).rejects.toThrow(/manifest/);
		expect(await stat(target).catch(() => null)).toBeNull();
	});

	it("never restores into a non-empty directory or the directory the server is configured to use", async () => {
		const s = await seeded();
		const { dir } = await backupData({ feltDir: s.felt, outRoot: join(s.root, "b") });
		await expect(restoreBackup({ backupDir: dir, feltTarget: s.felt })).rejects.toThrow(/not empty/);
		const empty = join(s.root, "empty");
		await mkdir(empty);
		await expect(restoreBackup({ backupDir: dir, feltTarget: empty, liveDirs: [empty] })).rejects.toThrow(/configured to use/);
		const before = await readFile(join(s.felt, "state.json"));
		await expect(restoreBackup({ backupDir: dir, feltTarget: s.felt })).rejects.toThrow();
		expect(await readFile(join(s.felt, "state.json"))).toEqual(before);
	});

	it("verify-data reports a missing original, a changed original and a database that will not open; and refuses a directory a live process holds", async () => {
		const s = await seeded();
		expect((await verifyData({ feltDir: s.felt, documentsDir: s.docs })).ok).toBe(true);
		const workspaceDir = join(s.docs, (await readdir(s.docs))[0]!);
		await writeFile(join(workspaceDir, s.hash), "tampered");
		expect((await verifyData({ feltDir: s.felt, documentsDir: s.docs })).problems.join()).toContain("does not match its recorded hash");
		await rm(join(workspaceDir, s.hash));
		expect((await verifyData({ feltDir: s.felt, documentsDir: s.docs })).problems.join()).toContain("missing");
		const broken = join(s.root, "broken");
		await cp(s.felt, broken, { recursive: true });
		for (const f of await readdir(broken)) await writeFile(join(broken, f), "garbage{");
		const report = await verifyData({ feltDir: broken });
		expect(report.ok).toBe(false);
		expect(report.problems.join()).toContain("not valid JSON");
		await writeFile(join(s.felt, "state.lock"), JSON.stringify({ pid: process.pid, token: "t" }));
		expect((await verifyData({ feltDir: s.felt })).problems.join()).toContain("in use by process");
	});
});

describe("the store itself refuses to start empty over unreadable data", () => {
	it("throws instead of letting FeltDB reinitialise; a good state.json.backup alone is still accepted", async () => {
		const s = await seeded();
		const copy = join(s.root, "c");
		await cp(s.felt, copy, { recursive: true });
		await writeFile(join(copy, "state.json"), "garbage");
		for (const f of await readdir(copy)) if (f === "state.json.backup") await rm(join(copy, f));
		await expect(InvestStore.openDir(copy)).rejects.toThrow(/Refusing to start empty/);
		// the damaged files were not touched or replaced by an empty database
		expect((await readFile(join(copy, "state.json"))).toString()).toBe("garbage");
		await expect(InvestStore.openDir(join(s.root, "brand-new"))).resolves.toBeDefined();
	});
});

describe("crash and concurrency (real processes)", () => {
	const writer = async (felt: string, tag: string, n: number, killAfterMs?: number) => {
		const script = join(felt, "..", `w-${tag}.ts`);
		await writeFile(
			script,
			`import { C, InvestStore } from ${JSON.stringify(join(import.meta.dir, "../store/store.ts"))};
const s = await InvestStore.openDir(${JSON.stringify(felt)});
for (let i = 0; i < ${n}; i++) {
  await s.commit({ principalId: "p", workspaceId: "ws-a" }, { writes: [{ collection: C.startups, id: "${tag}_" + i, create: true, value: { workspaceId: "ws-a", name: "${tag}" + i } }], audit: [] });
  if (i === 5) console.log("started");
}
await s.close();`,
		);
		const proc = Bun.spawn(["bun", script], { stdout: "pipe", stderr: "pipe" });
		if (killAfterMs !== undefined) {
			await new Promise((r) => setTimeout(r, killAfterMs));
			proc.kill(9);
		}
		await proc.exited;
		return proc.exitCode;
	};

	it("two writer processes on one directory lose no commit", async () => {
		const root = await tmp();
		const felt = join(root, "felt");
		await (await InvestStore.openDir(felt)).close();
		const [a, b] = await Promise.all([writer(felt, "a", 40), writer(felt, "b", 40)]);
		expect([a, b]).toEqual([0, 0]);
		const store = await InvestStore.openDir(felt);
		expect(await store.list(C.startups, "ws-a")).toHaveLength(80);
		await store.close();
	}, 60_000);

	it("a writer killed with SIGKILL mid-run leaves a database that reopens, verifies and accepts new writes (committed records are kept, none are torn)", async () => {
		const root = await tmp();
		const felt = join(root, "felt");
		await (await InvestStore.openDir(felt)).close();
		await writer(felt, "k", 100000, 1500);
		await rm(join(felt, "state.lock"), { force: true }); // a killed process cannot release its own lock; the operator (or FeltDB's stale-lock rule) clears it
		const report = await verifyData({ feltDir: felt });
		expect(report.ok).toBe(true);
		const store = await InvestStore.openDir(felt);
		const before = (await store.list<{ id: string }>(C.startups, "ws-a")).length;
		expect(before).toBeGreaterThan(0);
		await store.commit(actor, { writes: [{ collection: C.startups, id: "after", create: true, value: { workspaceId: "ws-a", name: "after" } }], audit: [] });
		expect(await store.list(C.startups, "ws-a")).toHaveLength(before + 1);
		await store.close();
	}, 60_000);
});
