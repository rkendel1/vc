import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Outcome, ProvenanceClass, VerificationStatus } from "../../../invest/domain/types.ts";
import { ApiError } from "./api.ts";
import { formatDate } from "./format.ts";
import { TONE_MARK, type Entry, type Tone } from "./vocab.ts";

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type Principal = { principalId: string; displayName: string; workspaceId: string; workspaceName: string; role: string | null; permissions: string[] };
export type JevIdentity = { configured: boolean; endpointOrigin: string | null; provider: string | null; model: string | null; adapterVersion: string };
export type Session = { principal: Principal; jev: JevIdentity };

export const SessionContext = createContext<Session | null>(null);
export function useSession(): Session {
	const s = useContext(SessionContext);
	if (!s) throw new Error("no session");
	return s;
}
export function useCan(permission: string): boolean {
	return useSession().principal.permissions.includes(permission);
}

// ---------------------------------------------------------------------------
// Routing (hash based: the server serves one page)
// ---------------------------------------------------------------------------

export function useRoute(): string[] {
	const read = () => (window.location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean);
	const [parts, setParts] = useState(read);
	useEffect(() => {
		const on = () => setParts(read());
		window.addEventListener("hashchange", on);
		return () => window.removeEventListener("hashchange", on);
	}, []);
	return parts;
}
export function href(...parts: string[]): string {
	return `#/${parts.map(encodeURIComponent).join("/")}`;
}
export function navigate(...parts: string[]) {
	window.location.hash = href(...parts);
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

export function useLoad<T>(load: () => Promise<T>, deps: unknown[], options: { pollMs?: (data: T | null) => number | null } = {}) {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<ApiError | null>(null);
	const [loading, setLoading] = useState(true);
	const counter = useRef(0);
	const reload = useCallback(async () => {
		const n = ++counter.current;
		try {
			const value = await load();
			if (n === counter.current) {
				setData(value);
				setError(null);
			}
		} catch (e) {
			if (n === counter.current) setError(e as ApiError);
		} finally {
			if (n === counter.current) setLoading(false);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
	useEffect(() => {
		setLoading(true);
		void reload();
	}, [reload]);
	const poll = options.pollMs?.(data) ?? null;
	useEffect(() => {
		if (!poll) return;
		const t = setInterval(() => void reload(), poll);
		return () => clearInterval(t);
	}, [poll, reload]);
	return { data, error, loading, reload, setData };
}

/** Runs an action, tracking busy state and its error for display next to the control that started it. */
export function useAction() {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<ApiError | null>(null);
	const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
		setBusy(true);
		setError(null);
		try {
			return await fn();
		} catch (e) {
			setError(e as ApiError);
			return undefined;
		} finally {
			setBusy(false);
		}
	}, []);
	return { busy, error, run, clear: () => setError(null) };
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const OUTCOME_LABEL: Record<Outcome, string> = {
	supported: "Supported",
	partially_supported: "Partially supported",
	contradicted: "Contradicted",
	insufficient_evidence: "Insufficient evidence",
	not_applicable: "Not applicable",
	evaluation_failed: "Evaluation failed",
};
export const OUTCOME_ORDER: Outcome[] = ["supported", "partially_supported", "contradicted", "insufficient_evidence", "not_applicable", "evaluation_failed"];

/** Each outcome has its own shape as well as its colour, so the vocabulary survives greyscale and colour blindness. */
export function OutcomeMark({ outcome }: { outcome: Outcome }) {
	const common = { className: `mark o-${outcome}`, viewBox: "0 0 16 16", "aria-hidden": true } as const;
	switch (outcome) {
		case "supported":
			return (
				<svg {...common}>
					<circle cx="8" cy="8" r="6.5" fill="var(--o)" />
				</svg>
			);
		case "partially_supported":
			return (
				<svg {...common}>
					<circle cx="8" cy="8" r="6" fill="none" stroke="var(--o)" strokeWidth="1.6" />
					<path d="M8 2a6 6 0 0 1 0 12z" fill="var(--o)" />
				</svg>
			);
		case "contradicted":
			return (
				<svg {...common}>
					<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="var(--o)" strokeWidth="2.4" strokeLinecap="round" />
				</svg>
			);
		case "insufficient_evidence":
			return (
				<svg {...common}>
					<circle cx="8" cy="8" r="6" fill="none" stroke="var(--o)" strokeWidth="1.6" />
				</svg>
			);
		case "not_applicable":
			return (
				<svg {...common}>
					<path d="M3 8h10" stroke="var(--o)" strokeWidth="2" strokeLinecap="round" />
				</svg>
			);
		default:
			return (
				<svg {...common}>
					<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="var(--o)" strokeWidth="1.6" strokeDasharray="2.5 2" />
				</svg>
			);
	}
}

export function OutcomeLabel({ outcome }: { outcome: Outcome }) {
	return (
		<span className={`outcome o-${outcome}`}>
			<OutcomeMark outcome={outcome} />
			{OUTCOME_LABEL[outcome]}
		</span>
	);
}

export function CoverageBar({ byOutcome, total }: { byOutcome: Record<Outcome, number>; total: number }) {
	if (!total) return <div className="coverage" aria-label="No criteria" />;
	const label = OUTCOME_ORDER.filter((o) => byOutcome[o]).map((o) => `${byOutcome[o]} ${OUTCOME_LABEL[o].toLowerCase()}`).join(", ");
	return (
		<div className="coverage" role="img" aria-label={label} title={label}>
			{OUTCOME_ORDER.map((o) => (byOutcome[o] ? <span key={o} className={`o-${o}`} style={{ width: `${(byOutcome[o] / total) * 100}%` }} /> : null))}
		</div>
	);
}

const PROVENANCE_LABEL: Record<ProvenanceClass, string> = { founder_reported: "Founder-reported", independent: "Independent", reviewer_verified: "Reviewer-verified" };
export function Provenance({ value }: { value: ProvenanceClass }) {
	return <span className={`prov ${value}`}>{PROVENANCE_LABEL[value]}</span>;
}

const VERIFICATION_LABEL: Record<VerificationStatus, string> = { unverified: "Not cross-checked", corroborated: "Corroborated", contradicted: "Conflicts with another source", reviewer_verified: "Verified by reviewer" };
export function Verification({ value }: { value: VerificationStatus }) {
	return <span className={`verif ${value}`}>{VERIFICATION_LABEL[value]}</span>;
}

export function Status({ value }: { value: string }) {
	return <span className={`status ${value}`}>{value.replace(/_/g, " ")}</span>;
}

// ---------------------------------------------------------------------------
// Layout and feedback
// ---------------------------------------------------------------------------

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
	return (
		<div className="page-head">
			<div>
				<h1>{title}</h1>
				{sub ? <div className="sub">{sub}</div> : null}
			</div>
			{actions ? <div className="row">{actions}</div> : null}
		</div>
	);
}

export function Section({ title, actions, children, id }: { title: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
	return (
		<section className="section" id={id}>
			<header>
				<h2>{title}</h2>
				{actions ? <div className="row">{actions}</div> : null}
			</header>
			{children}
		</section>
	);
}

export function ErrorNote({ error }: { error: ApiError | null }) {
	if (!error) return null;
	const details = error.details as { errors?: { path: string; message: string }[]; blockers?: string[] } | undefined;
	return (
		<div className="note error" role="alert">
			{error.message}
			{details?.errors?.length ? (
				<ul className="blockers">
					{details.errors.map((e) => (
						<li key={e.path + e.message}>
							<code>{e.path}</code> {e.message}
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

export function Loading({ what }: { what: string }) {
	return <p className="empty">Loading {what}…</p>;
}

export function when(iso: string | null | undefined): string {
	return formatDate(iso);
}

export function shortDigest(d: string): string {
	return d.replace(/^sha256:/, "").slice(0, 12);
}

export function metricUnit(key: string): string {
	if (key.endsWith("_pct")) return "percent";
	if (key === "runway_months") return "months";
	if (key === "customers" || key === "team_size") return "count";
	return "usd";
}

const COMPARATOR_WORDS: Record<string, string> = { gte: "at least", gt: "more than", lte: "at most", lt: "less than", eq: "exactly" };
export function describeCheck(metric: string, comparator: string, threshold: number): string {
	return `${metric.replace(/_pct$/, "").replace(/_/g, " ")} ${COMPARATOR_WORDS[comparator] ?? comparator} ${money(threshold, metricUnit(metric))}`;
}

export function money(value: number, unit?: string): string {
	if (unit === "usd") {
		const abs = Math.abs(value);
		if (abs >= 1e9) return `$${+(value / 1e9).toFixed(2)}B`;
		if (abs >= 1e6) return `$${+(value / 1e6).toFixed(2)}M`;
		if (abs >= 1e3) return `$${+(value / 1e3).toFixed(1)}K`;
		return `$${value}`;
	}
	if (unit === "percent") return `${value}%`;
	if (unit === "months") return `${value} months`;
	return String(value);
}

// ---------------------------------------------------------------------------
// Product components: one way to show a status, a notice, a confirmation, an empty state, a progress trail
// ---------------------------------------------------------------------------

/** A status badge. The meaning is in the words and a glyph, never in colour alone; the longer explanation is its tooltip and, where room allows, a line beneath. */
export function Badge({ entry, tone, children, explain }: { entry?: Entry; tone?: Tone; children?: ReactNode; explain?: boolean }) {
	const t = entry?.tone ?? tone ?? "neutral";
	return (
		<span className={`badge tone-${t}`} title={entry?.help || undefined}>
			<span className="badge-mark" aria-hidden="true">
				{TONE_MARK[t]}
			</span>
			{children ?? entry?.label}
			{explain && entry?.help ? <span className="badge-help"> — {entry.help}</span> : null}
		</span>
	);
}

/** Feedback that stays until the next action. `status` is polite; `alert` interrupts. */
export function Notice({ kind = "info", title, children }: { kind?: "info" | "success" | "warn" | "error"; title?: ReactNode; children?: ReactNode }) {
	return (
		<div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
			{title ? <strong>{title}</strong> : null}
			{children ? <div>{children}</div> : null}
		</div>
	);
}

export function EmptyState({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
	return (
		<div className="empty-state">
			<strong>{title}</strong>
			{children ? <p className="muted">{children}</p> : null}
			{actions ? <div className="row">{actions}</div> : null}
		</div>
	);
}

/** A trail of states with the current one marked; each step names what is done, what is next. */
export function Steps({ steps }: { steps: { label: string; state: "done" | "current" | "todo" | "blocked"; note?: string }[] }) {
	return (
		<ol className="steps" aria-label="Progress">
			{steps.map((s) => (
				<li key={s.label} className={`step ${s.state}`} aria-current={s.state === "current" ? "step" : undefined}>
					<span className="step-mark" aria-hidden="true">
						{s.state === "done" ? "✓" : s.state === "blocked" ? "✕" : s.state === "current" ? "→" : "○"}
					</span>
					<span>
						<strong>{s.label}</strong>
						<span className="visually-hidden">{`: ${s.state === "done" ? "done" : s.state === "current" ? "current step" : s.state === "blocked" ? "stopped" : "not yet"}`}</span>
						{s.note ? <span className="muted small"> {s.note}</span> : null}
					</span>
				</li>
			))}
		</ol>
	);
}

/**
 * A consequential action behind a modal confirmation. Uses the native dialog element: focus moves inside, Tab stays inside, Esc cancels,
 * and focus returns to the button that opened it. The consequence is stated in plain words; nothing happens until the person confirms.
 */
export function ConfirmButton({ label, title, consequence, confirmLabel, onConfirm, className, disabled, danger, children }: { label: ReactNode; title: string; consequence: ReactNode; confirmLabel: string; onConfirm: () => Promise<unknown> | unknown; className?: string; disabled?: boolean; danger?: boolean; children?: ReactNode }) {
	const ref = useRef<HTMLDialogElement>(null);
	const [busy, setBusy] = useState(false);
	return (
		<>
			<button type="button" className={className} disabled={disabled} onClick={() => ref.current?.showModal()}>
				{label}
			</button>
			<dialog ref={ref} className="confirm" aria-labelledby={`dlg-${title.replace(/\W+/g, "-")}`} onClose={() => setBusy(false)}>
				<h2 id={`dlg-${title.replace(/\W+/g, "-")}`}>{title}</h2>
				<div className="stack">
					<div>{consequence}</div>
					{children}
					<div className="row">
						<button type="button" className={danger ? "danger" : "primary"} disabled={busy} onClick={async () => {
							setBusy(true);
							try {
								await onConfirm();
							} finally {
								setBusy(false);
								ref.current?.close();
							}
						}}>
							{confirmLabel}
						</button>
						<button type="button" className="quiet" onClick={() => ref.current?.close()} autoFocus>
							Cancel
						</button>
					</div>
				</div>
			</dialog>
		</>
	);
}

/** Shown for a route the person's role does not include, instead of a blank page or a raw error. */
export function NotAvailable({ home }: { home: string }) {
	return (
		<EmptyState title="This page is not part of your role" actions={<a className="button" href={home ? href(home) : "#/"}>Go to your start page</a>}>
			Your account does not include this area. If you need it, ask your workspace administrator.
		</EmptyState>
	);
}
