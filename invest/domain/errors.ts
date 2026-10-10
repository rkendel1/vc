/** Domain failures. The AppPort layer maps each code to a protocol error; nothing else leaks. */
export type InvestErrorCode = "invalid" | "not_found" | "conflict" | "forbidden" | "precondition" | "unavailable" | "too_large";

export class InvestError extends Error {
	constructor(
		readonly code: InvestErrorCode,
		message: string,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "InvestError";
	}
}

export const invalid = (message: string, details?: Record<string, unknown>) => new InvestError("invalid", message, details);
/** Used both for absent records and for records in another workspace, so existence never leaks. */
export const notFound = (what: string) => new InvestError("not_found", `${what} not found`);
export const conflict = (message: string, details?: Record<string, unknown>) => new InvestError("conflict", message, details);
export const precondition = (message: string, details?: Record<string, unknown>) => new InvestError("precondition", message, details);
export const forbidden = (message: string) => new InvestError("forbidden", message);
