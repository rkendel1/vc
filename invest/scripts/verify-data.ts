/**
 * Integrity check of a database directory (and documents): opens it with the real store, counts every collection,
 * checks references between records and that every stored original matches its recorded hash.
 *
 *   bun run verify-data -- --dir <database dir> [--documents <documents dir>]     (defaults: FELTDB_DIR, DOCUMENT_STORAGE_DIR)
 *   bun run verify-data -- --backup <backup dir>                                  (checks file hashes against the manifest)
 *
 * Refuses a directory a running server holds; verify a backup or restored copy instead. Opening a database can repair a torn journal tail.
 */
import { verifyBackup, verifyData } from "./lib/data-safety.ts";

const argv = process.argv.slice(2);
const value = (n: string) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const backup = value("backup");
const report = backup
	? await verifyBackup(backup).catch((e: Error) => ({ ok: false, problems: [e.message], manifest: null }))
	: await verifyData({ feltDir: value("dir") ?? process.env.FELTDB_DIR ?? "", documentsDir: value("documents") ?? process.env.DOCUMENT_STORAGE_DIR });
console.log(report.ok ? "OK: data verified." : "NOT OK:");
for (const p of report.problems) console.log(`  - ${p}`);
process.exit(report.ok ? 0 : 1);
