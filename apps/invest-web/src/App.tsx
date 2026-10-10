import { type FormEvent, useCallback, useEffect, useState } from "react";
import { call, getToken, setToken } from "./api.ts";
import { AuditScreen } from "./screens/Audit.tsx";
import { ReportScreen } from "./screens/Report.tsx";
import { StartupScreen, StartupsScreen } from "./screens/Startups.tsx";
import { ThesesScreen, ThesisScreen } from "./screens/Theses.tsx";
import { WorkspaceScreen } from "./screens/Workspace.tsx";
import { type Session, SessionContext, href, useRoute } from "./ui.tsx";

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
		const out = () => setSession(null);
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
			<p className="muted">Evaluate startups against your own investment criteria, with every finding traced to its evidence.</p>
			<label className="field">
				Access token
				<input type="password" autoComplete="current-password" value={token} onChange={(e) => setValue(e.target.value)} autoFocus />
				<span className="hint">Issued by your workspace administrator. It is kept only for this browser tab.</span>
			</label>
			{error ? <div className="note error">That token was not accepted. Check it and try again.</div> : null}
			<div>
				<button className="primary" type="submit">
					Sign in
				</button>
			</div>
		</form>
	);
}

const NAV = [
	{ path: "", label: "Workspace" },
	{ path: "theses", label: "Theses" },
	{ path: "startups", label: "Startups" },
	{ path: "audit", label: "Audit trail" },
];

function Shell({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
	const route = useRoute();
	const section = route[0] === "evaluations" ? "startups" : (route[0] ?? "");
	let screen;
	if (route[0] === "theses" && route[1]) screen = <ThesisScreen thesisId={route[1]} />;
	else if (route[0] === "theses") screen = <ThesesScreen />;
	else if (route[0] === "startups" && route[1]) screen = <StartupScreen startupId={route[1]} />;
	else if (route[0] === "startups") screen = <StartupsScreen />;
	else if (route[0] === "evaluations" && route[1]) screen = <ReportScreen evaluationId={route[1]} />;
	else if (route[0] === "audit") screen = <AuditScreen />;
	else screen = <WorkspaceScreen />;
	return (
		<div className="shell">
			<aside className="rail">
				<div>
					<div className="wordmark">Attn Invest</div>
					<div className="workspace">{session.principal.workspaceName}</div>
				</div>
				<nav aria-label="Sections">
					{NAV.map((n) => (
						<a key={n.path} href={n.path ? href(n.path) : "#/"} aria-current={section === n.path ? "page" : undefined}>
							{n.label}
						</a>
					))}
				</nav>
				<div className="who">
					<span>
						{session.principal.displayName}
						{session.principal.role ? <span className="muted">, {session.principal.role}</span> : null}
					</span>
					<button className="quiet" type="button" onClick={onSignOut} style={{ alignSelf: "flex-start", padding: 0 }}>
						Sign out
					</button>
				</div>
			</aside>
			<main key={route.join("/")}>{screen}</main>
		</div>
	);
}
