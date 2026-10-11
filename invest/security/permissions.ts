import { stat } from "node:fs/promises";

/**
 * Secrets and data must not be readable by other accounts on the machine. Production refuses to start if they are; elsewhere it is a warning.
 * Checks the owner-permission bits only (POSIX); on a filesystem that reports none, nothing is claimed.
 */
export async function privateEnough(path: string): Promise<{ ok: boolean; mode: string | null }> {
	try {
		const st = await stat(path);
		const mode = st.mode & 0o777;
		return { ok: (mode & 0o007) === 0, mode: mode.toString(8) };
	} catch {
		return { ok: true, mode: null };
	}
}

export async function assertPrivate(items: { path: string; what: string }[], options: { production: boolean; warn: (message: string) => void }): Promise<void> {
	for (const { path, what } of items) {
		const r = await privateEnough(path);
		if (r.ok) continue;
		const message = `${what} (${path}) is readable by other accounts (mode ${r.mode}); run chmod o-rwx on it`;
		if (options.production) throw new Error(message);
		options.warn(message);
	}
}
