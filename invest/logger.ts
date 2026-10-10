import type { LogLevel } from "./config.ts";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEYS = /(authorization|api[-_]?key|token|secret|password|credential|cookie)/i;

/** Removes credential-shaped fields and bearer strings before anything is written to a log. */
export function redact(value: unknown, depth = 0): unknown {
	if (depth > 6) return "[depth]";
	if (typeof value === "string") return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
	if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
		return out;
	}
	return value;
}

export type Logger = {
	debug(message: string, fields?: Record<string, unknown>): void;
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
};

export function createLogger(level: LogLevel, sink: (line: string) => void = (l) => console.log(l)): Logger {
	const emit = (lvl: LogLevel, message: string, fields?: Record<string, unknown>) => {
		if (ORDER[lvl] < ORDER[level]) return;
		sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg: message, ...((redact(fields ?? {}) as object) ?? {}) }));
	};
	return {
		debug: (m, f) => emit("debug", m, f),
		info: (m, f) => emit("info", m, f),
		warn: (m, f) => emit("warn", m, f),
		error: (m, f) => emit("error", m, f),
	};
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
