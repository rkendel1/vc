/**
 * Role-aware navigation and route access. Pure, so it is unit-tested. Everything is derived from the session's permissions; the role
 * label only picks the landing page and the founder-specific journey. The server enforces every permission regardless: hiding a link
 * is a courtesy to the user, never the security boundary.
 */
export type Who = { role: string | null; permissions: readonly string[] };
export type NavItem = { label: string; path: string; /** Route heads that mark this item as current. */ heads: string[] };
export type Audience = "founder" | "representative" | "moderator" | "fund";

const has = (w: Who, p: string) => w.permissions.includes(p);

export function audienceOf(w: Who): Audience {
	if (w.role === "founder") return "founder";
	if (has(w, "moderation.review")) return "moderator";
	// A fund partner can also claim a profile, but a fund works on its own evaluations; a representative has no evaluation rights.
	if (has(w, "profile.claim") && !has(w, "thesis.write") && !has(w, "evaluation.run")) return "representative";
	return "fund";
}

export const AUDIENCE_LABEL: Record<Audience, string> = { founder: "Founder", representative: "Investor representative", moderator: "Moderator", fund: "Fund team" };
/** What the role means for the person, in one sentence under their name. */
export const AUDIENCE_HELP: Record<Audience, string> = {
	founder: "Your startup, evidence, investor matches and shortlist are private to this workspace.",
	representative: "You manage how your firm appears, once a moderator has verified you.",
	moderator: "You review claims and submissions across the platform.",
	fund: "You evaluate startups against your own criteria and review investor research.",
};

export function homePath(w: Who): string {
	switch (audienceOf(w)) {
		case "founder":
			return "founder";
		case "representative":
			return "firm";
		case "moderator":
			return "review";
		default:
			return "";
	}
}

export function navFor(w: Who, ctx: { startupId?: string | null } = {}): { main: NavItem[]; operations: NavItem[] } {
	const a = audienceOf(w);
	const main: NavItem[] = [];
	if (a === "founder") {
		const base = ctx.startupId ? `founder/${ctx.startupId}` : "founder";
		main.push(
			{ label: "Startup", path: ctx.startupId ? `${base}/profile` : "founder", heads: ["founder"] },
			{ label: "Find investors", path: ctx.startupId ? `${base}/investors` : "founder", heads: [] },
			{ label: "Shortlist", path: ctx.startupId ? `${base}/shortlist` : "founder", heads: [] },
			{ label: "Your notes", path: "notes", heads: ["notes"] },
		);
	} else if (a === "representative") {
		main.push({ label: "My firm", path: "firm", heads: ["firm", "investors"] });
	} else if (a === "moderator") {
		main.push({ label: "Review queue", path: "review", heads: ["review"] });
	} else {
		main.push({ label: "Overview", path: "", heads: ["", "evaluations"] });
		if (has(w, "thesis.write") || has(w, "invest.read")) main.push({ label: "Theses", path: "theses", heads: ["theses"] });
		main.push({ label: "Startups", path: "startups", heads: ["startups"] }, { label: "Investor research", path: "investors", heads: ["investors"] });
	}
	if (has(w, "audit.read")) main.push({ label: "History", path: "history", heads: ["history", "audit"] });
	const operations: NavItem[] = [];
	if (has(w, "source.manage")) {
		operations.push({ label: "Research sources", path: "operations/sources", heads: [] });
		if (has(w, "research.run")) operations.push({ label: "Monitoring", path: "operations/monitoring", heads: [] });
		operations.push({ label: "System health", path: "operations/system", heads: [] });
	}
	return { main, operations };
}

/** Whether the person may open a route. A route they may not open explains itself rather than rendering an error. */
export function canOpen(w: Who, route: string[]): boolean {
	const head = route[0] ?? "";
	const a = audienceOf(w);
	switch (head) {
		case "":
		case "theses":
		case "startups":
		case "evaluations":
			return a === "fund";
		case "founder":
			return a === "founder";
		case "notes":
			return has(w, "contribution.write");
		case "firm":
			return a === "representative";
		case "review":
			return a === "moderator";
		case "investors":
			return a !== "founder" && a !== "moderator";
		case "history":
		case "audit":
			return has(w, "audit.read");
		case "operations":
			if (!has(w, "source.manage")) return false;
			return route[1] !== "monitoring" || has(w, "research.run");
		default:
			return false;
	}
}

/** The nav item to mark current, by the route's first segment and, for the founder journey, its step. */
export function currentItem(items: NavItem[], route: string[]): string | null {
	const head = route[0] ?? "";
	if (head === "founder" && route[1]) {
		const step = route[2] ?? "profile";
		const label = step === "investors" ? "Find investors" : step === "shortlist" ? "Shortlist" : "Startup";
		return items.find((i) => i.label === label)?.label ?? null;
	}
	return items.find((i) => i.heads.includes(head))?.label ?? null;
}
