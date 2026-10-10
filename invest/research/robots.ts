/** robots.txt (RFC 9309) evaluation for one product token. Longest matching rule wins; Allow wins ties. */

export type RobotsRules = { allowAll: boolean; disallowAll: boolean; rules: { allow: boolean; pattern: string }[]; crawlDelayMs: number | null; unavailable: boolean };

export const ALLOW_ALL: RobotsRules = { allowAll: true, disallowAll: false, rules: [], crawlDelayMs: null, unavailable: false };
export const DISALLOW_ALL_UNAVAILABLE: RobotsRules = { allowAll: false, disallowAll: true, rules: [], crawlDelayMs: null, unavailable: true };

export function parseRobots(text: string, productToken: string): RobotsRules {
	const token = productToken.toLowerCase();
	type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[]; delay: number | null };
	const groups: Group[] = [];
	let current: Group | null = null;
	let lastWasAgent = false;
	for (const rawLine of text.slice(0, 512 * 1024).split(/\r?\n/)) {
		const line = rawLine.replace(/#.*/, "").trim();
		const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
		if (!m) continue;
		const key = m[1]!.toLowerCase();
		const value = m[2]!.trim();
		if (key === "user-agent") {
			if (!current || !lastWasAgent) {
				current = { agents: [], rules: [], delay: null };
				groups.push(current);
			}
			current.agents.push(value.toLowerCase());
			lastWasAgent = true;
			continue;
		}
		lastWasAgent = false;
		if (!current) continue;
		if (key === "allow" || key === "disallow") current.rules.push({ allow: key === "allow", pattern: value });
		else if (key === "crawl-delay") {
			const n = Number(value);
			if (Number.isFinite(n) && n >= 0) current.delay = n;
		}
	}
	const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
	const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
	if (!chosen.length) return ALLOW_ALL;
	const rules = chosen.flatMap((g) => g.rules).filter((r) => r.pattern !== "");
	const delay = chosen.map((g) => g.delay).find((d) => d !== null) ?? null;
	return { allowAll: false, disallowAll: false, rules, crawlDelayMs: delay === null ? null : Math.min(delay, 30) * 1000, unavailable: false };
}

function patternToRegex(pattern: string): RegExp {
	const anchored = pattern.endsWith("$");
	const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
	if (rules.disallowAll) return false;
	if (rules.allowAll) return true;
	let best: { allow: boolean; length: number } | null = null;
	for (const rule of rules.rules) {
		if (!patternToRegex(rule.pattern).test(pathAndQuery)) continue;
		const length = rule.pattern.length;
		if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
	}
	return best ? best.allow : true;
}
