/**
 * Restore a backup into NEW, EMPTY directories and verify it. Never overwrites, never touches the live directories.
 *
 *   bun run restore -- --from <backup dir> --to <new database dir> [--documents-to <new documents dir>]
 *
 * To cut over: stop the server, point FELTDB_DIR (and DOCUMENT_STORAGE_DIR) at the restored directories, run `bun run preflight`, start.
 */
import { DataSafetyError, restoreBackup } from "./lib/data-safety.ts";

const argv = process.argv.slice(2);
const value = (n: string) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const from = value("from");
const to = value("to");
if (!from || !to) {
	console.error("Usage: bun run restore -- --from <backup dir> --to <new empty database dir> [--documents-to <new empty documents dir>]");
	process.exit(2);
}
try {
	const { counts } = await restoreBackup({ backupDir: from, feltTarget: to, documentsTarget: value("documents-to"), liveDirs: [process.env.FELTDB_DIR ?? "", process.env.DOCUMENT_STORAGE_DIR ?? ""] });
	console.log(`Restored and verified into ${to}: ${Object.values(counts).reduce((a, b) => a + b, 0)} records.`);
	console.log("The live data was not touched. See docs/invest/PRODUCTION_READINESS.md for cut-over.");
} catch (error) {
	console.error(`Restore failed: ${error instanceof DataSafetyError ? error.message : String(error).slice(0, 300)}`);
	process.exit(1);
}
