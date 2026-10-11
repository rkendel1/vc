/**
 * Pure rules the founder screens share, kept apart from React so they are unit-tested: what is wrong with a draft profile, what is still
 * missing before investors can be compared, and how active filters read in words.
 */
import { PROFILE_METRICS, type Known, type ProfileContent } from "../../../invest/domain/founder.ts";
import { term } from "./format.ts";

export type Draft = ProfileContent;
export type Errors = Record<string, string>;

/** Checks the draft before anything is sent, so the founder fixes it where it is and loses nothing. */
export function validateDraft(d: Draft): Errors {
	const e: Errors = {};
	const provided = <T,>(k: Known<T>): k is Extract<Known<T>, { state: "provided" }> => k.state === "provided";
	const needList = (key: string, k: Known<string[]>, what: string) => {
		if (provided(k) && (!Array.isArray(k.value) || k.value.length === 0)) e[key] = `Choose at least one ${what}, or mark this unknown.`;
	};
	needList("sectors", d.sectors, "sector");
	needList("businessModels", d.businessModels, "business model");
	needList("targetMarkets", d.targetMarkets, "market");
	const needValue = (key: string, k: Known<unknown>, what: string) => {
		if (provided(k) && (k.value === undefined || k.value === "")) e[key] = `Choose ${what}, or mark this unknown.`;
	};
	needValue("headquarters", d.headquarters, "a location");
	needValue("currentStage", d.currentStage, "a stage");
	needValue("fundraisingStage", d.fundraisingStage, "a round");
	needValue("revenueStatus", d.revenueStatus, "a revenue status");
	needValue("productStatus", d.productStatus, "a product status");
	if (provided(d.team) && !String(d.team.value ?? "").trim()) e.team = "Describe the team, or mark this unknown.";
	if (provided(d.targetRaise)) {
		const v = d.targetRaise.value ?? { minUsd: null, maxUsd: null };
		if (v.minUsd === null && v.maxUsd === null) e.targetRaise = "Enter at least one amount in US dollars, or mark this unknown.";
		else if ([v.minUsd, v.maxUsd].some((n) => n !== null && (!Number.isFinite(n) || n < 0))) e.targetRaise = "Amounts must be positive numbers in US dollars.";
		else if (v.minUsd !== null && v.maxUsd !== null && v.minUsd > v.maxUsd) e.targetRaise = "The minimum is above the maximum.";
	}
	for (const key of PROFILE_METRICS) {
		const m = d.metrics?.[key];
		if (m && provided(m)) {
			if (m.value === undefined || m.value === null || Number.isNaN(m.value)) e[`metrics.${key}`] = "Enter a number, or mark this unknown.";
			else if (m.value < 0) e[`metrics.${key}`] = "Must not be negative.";
			else if (key === "gross_margin_pct" && m.value > 100) e[`metrics.${key}`] = "Gross margin cannot exceed 100%.";
		}
	}
	if ((d.description ?? "").length > 600) e.description = "Keep the description under 600 characters.";
	const bad = d.investorExclusions.find((x) => !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(x.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")));
	if (bad) e.investorExclusions = `"${bad}" is not a website domain such as firm.vc.`;
	return e;
}

/** What is still missing before investors can be compared with this profile. */
export function missingForMatching(d: Draft): string[] {
	const out: string[] = [];
	if (d.currentStage.state !== "provided" && d.fundraisingStage.state !== "provided") out.push("stage");
	if (d.sectors.state !== "provided") out.push("sector");
	if (d.headquarters.state !== "provided" && d.targetMarkets.state !== "provided") out.push("location or target markets");
	if (d.targetRaise.state !== "provided") out.push("target raise");
	return out;
}


export type Filters = { stage: string[]; sector: string[]; geography: string[]; businessModel: string[]; minUsd: string; maxUsd: string; approvedOnly: boolean; freshOnly: boolean; unknown: boolean; includeFounderExcluded: boolean; query: string };
export const NO_FILTERS: Filters = { stage: [], sector: [], geography: [], businessModel: [], minUsd: "", maxUsd: "", approvedOnly: false, freshOnly: false, unknown: true, includeFounderExcluded: false, query: "" };

/** Each active filter, in words, with a way to remove just that one. */
export function activeFilters(f: Filters): { label: string; clear: Partial<Filters> }[] {
	const out: { label: string; clear: Partial<Filters> }[] = [];
	const list = (k: "stage" | "sector" | "geography" | "businessModel", name: string) => f[k].length && out.push({ label: `${name}: ${f[k].map(term).join(", ")}`, clear: { [k]: [] } });
	list("stage", "Stage");
	list("sector", "Sector");
	list("geography", "Geography");
	list("businessModel", "Business model");
	if (f.minUsd || f.maxUsd) out.push({ label: `Cheque size ${f.minUsd ? `from $${Number(f.minUsd).toLocaleString("en-US")}` : ""}${f.minUsd && f.maxUsd ? " " : ""}${f.maxUsd ? `to $${Number(f.maxUsd).toLocaleString("en-US")}` : ""}`, clear: { minUsd: "", maxUsd: "" } });
	if (f.approvedOnly) out.push({ label: "Approved by the firm only", clear: { approvedOnly: false } });
	if (f.freshOnly) out.push({ label: "Current research only", clear: { freshOnly: false } });
	if (!f.unknown) out.push({ label: "Hiding investors with unknown criteria", clear: { unknown: true } });
	if (f.includeFounderExcluded) out.push({ label: "Including investors you excluded", clear: { includeFounderExcluded: false } });
	if (f.query.trim()) out.push({ label: `Name contains "${f.query.trim()}"`, clear: { query: "" } });
	return out;
}

