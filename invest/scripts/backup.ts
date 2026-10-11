/**
 * Consistent backup of the database (and optionally the original documents).
 *
 *   bun run backup -- --out /var/backups/invest [--with-documents]
 *
 * Reads FELTDB_DIR (and DOCUMENT_STORAGE_DIR with --with-documents) from the environment. Prefer running it with the server stopped; if the
 * server is running, the backup aborts rather than keep a copy that changed underneath it. It never reads the identity registry, the link
 * secret or any key. Output: <out>/invest-backup-<timestamp>/ with manifest.json (hashes + counts).
 */
import { DataSafetyError, backupData } from "./lib/data-safety.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const value = (n: string) => argv[argv.indexOf(`--${n}`) + 1];
const out = flag("out") ? value("out") : undefined;
const feltDir = process.env.FELTDB_DIR;
if (!out || !feltDir) {
	console.error("Usage: FELTDB_DIR=... [DOCUMENT_STORAGE_DIR=...] bun run backup -- --out <dir> [--with-documents]");
	process.exit(2);
}
if (flag("with-documents") && !process.env.DOCUMENT_STORAGE_DIR) {
	console.error("--with-documents needs DOCUMENT_STORAGE_DIR");
	process.exit(2);
}
try {
	const { dir, manifest } = await backupData({ feltDir, documentsDir: flag("with-documents") ? process.env.DOCUMENT_STORAGE_DIR : undefined, outRoot: out });
	console.log(`Backup written: ${dir}`);
	console.log(`  database files: ${manifest.database.length}; documents: ${manifest.documents.included ? manifest.documents.files.length : "not included"}`);
	console.log(`  records: ${Object.values(manifest.counts).reduce((a, b) => a + b, 0)} across ${Object.keys(manifest.counts).length} collections; verified on a scratch copy`);
	console.log("Test it with: bun run restore -- --from <dir> --to <new empty dir>");
} catch (error) {
	console.error(error instanceof DataSafetyError ? `Backup failed: ${error.message}` : `Backup failed: ${String(error).slice(0, 300)}`);
	process.exit(1);
}
