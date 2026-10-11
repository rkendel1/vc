import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { call, getToken, setToken } from "./api.ts";
import { AUDIENCE_HELP, AUDIENCE_LABEL, audienceOf, canOpen, currentItem, homePath, navFor } from "./nav.ts";
import { AuditScreen } from "./screens/Audit.tsx";
import { FirmScreen } from "./screens/Firm.tsx";
import { FounderScreen } from "./screens/Founder.tsx";
import { InvestorScreen, InvestorsScreen } from "./screens/Investors.tsx";
import { NotesScreen } from "./screens/Notes.tsx";
import { OperationsScreen } from "./screens/Operations.tsx";
import { ReportScreen } from "./screens/Report.tsx";
import { ReviewScreen } from "./screens/Review.tsx";
import { StartupScreen, StartupsScreen } from "./screens/Startups.tsx";
import { ThesesScreen, ThesisScreen } from "./screens/Theses.tsx";
import { WorkspaceScreen } from "./screens/Workspace.tsx";
import { NotAvailable, type Session, SessionContext, href, useRoute } from "./ui.tsx";

/** Leaving a session also leaves its page: the next person starts on their own start page, not on a record that belonged to someone else. */
function clearRoute() {
	try {
		sessionStorage.removeItem(LAST_STARTUP);
		history.replaceState(null, "", window.location.pathname + window.location.search);
	} catch {
		/* nothing to clear */
	}
}
const LAST_STARTUP = "attn-invest-last-startup";
export const rememberStartup = (id: string) => {
	try {
		sessionStorage.setItem(LAST_STARTUP, id);
	} catch {
		/* private mode: the nav simply links to the startup list */
	}
};
const lastStartup = () => {
	try {
		return sessionStorage.getItem(LAST_STARTUP);
	} catch {
		return null;
	}
};

export function App() {
	const [session, setSession] = useState<Session | null>(null);
	const [checking, setChecking] = useState(!!getToken());
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!getToken()) {
			setChecking(false);
			return;
		}
		setChecking(true);
		try {
			setSession(await call<Session>("session.whoami", {}));
			setError(null);
		} catch (e) {
			setSession(null);
			setError((e as Error).message);
		} finally {
			setChecking(false);
		}
	}, []);

	useEffect(() => {
		void load();
		const out = () => {
			clearRoute();
			setSession(null);
		};
		window.addEventListener("invest:signed-out", out);
		return () => window.removeEventListener("invest:signed-out", out);
	}, [load]);

	if (checking) return <p className="signin muted">Checking your access…</p>;
	if (!session) return <SignIn error={error} onSignedIn={load} />;
	return (
		<SessionContext.Provider value={session}>
			<Shell
				session={session}
				onSignOut={() => {
					setToken(null);
					clearRoute();
					setSession(null);
				}}
			/>
		</SessionContext.Provider>
	);
}

function SignIn({ error, onSignedIn }: { error: string | null; onSignedIn: () => void }) {
	const [token, setValue] = useState("");
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!token.trim()) return;
		setToken(token.trim());
		onSignedIn();
	};
	return (
		<form className="signin stack" onSubmit={submit}>
			<h1>Attn Invest</h1>
			<p className="muted">Founders and investors, matched on evidence you can inspect. Sign in with the access token your workspace administrator issued.</p>
			<label className="field">
				Access token
				<input type="password" autoComplete="current-password" value={token} onChange={(e) => setValue(e.target.value)} autoFocus aria-describedby="token-hint" />
				<span className="hint" id="token-hint">It is kept only for this browser tab and is cleared when you sign out.</span>
			</label>
			{error ? <div className="note error" role="alert">That token was not accepted. Check it and try again.</div> : null}
			<div>
				<button className="primary" type="submit">
					Sign in
				</button>
			</div>
		</form>
	);
}

function Shell({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
	const route = useRoute();
	const p = session.principal;
	const audience = audienceOf(p);
	const [startupId, setStartupId] = useState<string | null>(lastStartup());
	// Founders resume where they were: the startup page they last opened, or their only startup.
	useEffect(() => {
		if (audience !== "founder") return;
		if (route[0] === "founder" && route[1]) {
			rememberStartup(route[1]);
			setStartupId(route[1]);
			return;
		}
		if (startupId) return;
		void call<{ items: { id: string }[] }>("startup.list", {}).then((r) => r.items.length === 1 && setStartupId(r.items[0]!.id)).catch(() => undefined);
	}, [audience, route.join("/")]);
	const nav = navFor(p, { startupId });
	const current = currentItem(nav.main, route);
	const home = homePath(p);
	// A start page per role: a founder lands on their startup, a moderator on the queue.
	useEffect(() => {
		if (route.length === 0 && home) window.location.replace(href(home));
		if (route[0] === "audit") window.location.replace(href("history", ...route.slice(1)));
	}, [route.join("/"), home]);
	const mainRef = useRef<HTMLElement>(null);
	// Move focus to the page on navigation, so keyboard and screen-reader users start at the content, not the menu.
	useEffect(() => {
		mainRef.current?.focus({ preventScroll: true });
	}, [route.join("/")]);
	const head = route[0] ?? "";
	let screen;
	if (!canOpen(p, route)) screen = <NotAvailable home={home} />;
	else if (head === "founder") screen = <FounderScreen startupId={route[1]} step={route[2]} />;
	else if (head === "notes") screen = <NotesScreen />;
	else if (head === "firm") screen = <FirmScreen />;
	else if (head === "review") screen = <ReviewScreen />;
	else if (head === "operations") screen = <OperationsScreen tab={route[1]} />;
	else if (head === "history" || head === "audit") screen = <AuditScreen />;
	else if (head === "theses" && route[1]) screen = <ThesisScreen thesisId={route[1]} />;
	else if (head === "theses") screen = <ThesesScreen />;
	else if (head === "startups" && route[1]) screen = <StartupScreen startupId={route[1]} />;
	else if (head === "startups") screen = <StartupsScreen />;
	else if (head === "evaluations" && route[1]) screen = <ReportScreen evaluationId={route[1]} />;
	else if (head === "investors" && route[1]) screen = <InvestorScreen firmId={route[1]} />;
	else if (head === "investors") screen = <InvestorsScreen />;
	else if (head === "") screen = <WorkspaceScreen />;
	else screen = <NotAvailable home={home} />;
	const opsCurrent = nav.operations.find((n) => `operations/${route[1] ?? "sources"}` === n.path && head === "operations")?.label;
	return (
		<div className="shell">
			<a className="skip" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>
				Skip to content
			</a>
			<aside className="rail">
				<div>
					<div className="wordmark">Attn Invest</div>
					<div className="workspace" title="Your workspace">{p.workspaceName}</div>
				</div>
				<nav aria-label="Main">
					{nav.main.map((n) => (
						<a key={n.label} href={n.path ? href(...n.path.split("/")) : "#/"} aria-current={current === n.label ? "page" : undefined}>
							{n.label}
						</a>
					))}
				</nav>
				{nav.operations.length ? (
					<nav aria-label="Operations" className="ops">
						<div className="nav-heading">Operations</div>
						{nav.operations.map((n) => (
							<a key={n.label} href={href(...n.path.split("/"))} aria-current={opsCurrent === n.label ? "page" : undefined}>
								{n.label}
							</a>
						))}
					</nav>
				) : null}
				<div className="who">
					<div>
						<strong>{p.displayName}</strong>
						<div className="muted small" data-testid="role-line">
							{AUDIENCE_LABEL[audience]}
						</div>
						<div className="muted small">{AUDIENCE_HELP[audience]}</div>
					</div>
					<button className="quiet" type="button" onClick={onSignOut} style={{ alignSelf: "flex-start", padding: 0 }}>
						Sign out
					</button>
				</div>
			</aside>
			<main id="main" tabIndex={-1} ref={mainRef} key={route.join("/")}>
				{screen}
			</main>
		</div>
	);
}
