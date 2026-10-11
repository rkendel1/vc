/**
 * The product's shared vocabulary. Every label, explanation and tone for a recurring state lives here, so a status reads the same
 * on every screen. Distinct concepts stay distinct; each entry says what the state means and, where there is one, what to do about it.
 */
export type Tone = "ok" | "caution" | "bad" | "unknown" | "neutral";
export type Entry = { label: string; help: string; tone: Tone };
const e = (label: string, help: string, tone: Tone = "neutral"): Entry => ({ label, help, tone });

/** Where an investor criterion comes from. Never collapsed: approved by the firm is not the same as stated on its site. */
export const AUTHORITY: Record<string, Entry> = {
	investor_approved: e("Approved by the firm", "A verified representative of the firm approved and published this.", "ok"),
	workspace_approved: e("Adopted by your team", "Someone in this workspace reviewed the evidence and adopted it. The firm has not confirmed it.", "ok"),
	official_stated: e("Stated on the firm's own site", "Read from the firm's public pages. The firm has not confirmed it here, and pages can be out of date.", "neutral"),
	third_party: e("External source", "Reported by someone other than the firm. Useful context, not the firm's own statement.", "caution"),
	contributed: e("Contributed by a participant", "A founder or community member's account. Not verified.", "caution"),
	observed: e("Seen in past activity", "What the firm did in past deals. It does not say what the firm targets.", "unknown"),
	inferred: e("Inferred pattern", "A pattern across past investments. Never a stated policy.", "unknown"),
};

/** Investor fit: do the investor's sourced criteria allow this startup? */
export const FIT: Record<string, Entry> = {
	compatible_on_known: e("Fits on what is known", "No criterion that could be checked rules this startup out. Unknown criteria count neither way.", "ok"),
	partially_assessed: e("Only partly assessed", "Too few criteria could be checked to call this a fit.", "caution"),
	unknown: e("Not enough known", "Nothing could be compared yet. This is not a mismatch.", "unknown"),
	possible_mismatch: e("Possible mismatch to confirm", "A source suggests a mismatch, but none is authoritative enough to rule the investor out. Check before dropping it.", "caution"),
	eliminated: e("Ruled out", "A criterion the firm approved, or a current undisputed statement from the firm, excludes this startup.", "bad"),
};
export const CONSTRAINT: Record<string, Entry> = {
	compatible: e("Compatible", "The investor's criterion allows this.", "ok"),
	incompatible_hard: e("Incompatible", "An authoritative criterion rules this out.", "bad"),
	incompatible_soft: e("Possible mismatch", "A source suggests a mismatch but is not authoritative. Confirm before ruling the investor out.", "caution"),
	unknown: e("Unknown", "Not enough is known to compare. This is not a mismatch.", "unknown"),
};
export const UNKNOWN_WHY: Record<string, string> = {
	startup_field_missing: "Your profile does not state this yet.",
	no_criterion: "No criterion is known for this investor.",
	only_inferred: "Only inferred patterns exist, which do not establish a policy.",
	sources_conflict: "Sources disagree and nothing approved settles it.",
};

/** Research completeness: how much is actually known about the investor. */
export const COMPLETENESS: Record<string, Entry> = {
	verified: e("Mostly approved", "Most core criteria are approved by the firm or your team.", "ok"),
	partially_verified: e("Partly approved", "Some criteria are approved or stated by the firm; others are unverified or unknown.", "caution"),
	unverified_reports: e("Reports only", "Criteria come from external or contributed sources, not the firm.", "caution"),
	inferred: e("Inferred only", "Only patterns from past activity are known.", "unknown"),
	unknown: e("Little known", "Little or nothing is known about this investor's criteria.", "unknown"),
};
export const FIELD_COMPLETENESS: Record<string, string> = { approved: "approved by the firm", stated: "stated by the firm", reported: "reported by others", inferred: "inferred pattern", unknown: "unknown" };
export const FLAG: Record<string, Entry> = {
	disputed: e("Disputed", "Someone challenged a criterion and it has not been settled.", "caution"),
	stale: e("Out of date", "The research is older than the freshness window. Refresh it before relying on it.", "caution"),
	conflicted: e("Sources disagree", "Sources disagree and no approved value settles it.", "caution"),
	stub: e("Nothing found", "Research found no criteria for this investor.", "unknown"),
};

export const READINESS: Record<string, Entry> = {
	met: e("Provided", "Your profile covers this.", "ok"),
	not_met: e("Not met", "This investor's own criterion asks for something your profile says you do not have.", "bad"),
	evidence_not_provided: e("Not provided yet", "Your profile does not say. This is missing information, not a failed requirement.", "caution"),
	not_applicable: e("Not applicable", "Not expected at your stage or for your business. It is not counted against you.", "neutral"),
	not_assessable: e("Cannot be judged here", "The investor mentions it without a measurable threshold, so it is left for you to judge.", "unknown"),
};

/** Evidence quality: how well the startup's own claims are supported. */
export const EVIDENCE: Record<string, Entry> = {
	reviewer_verified: e("Checked by a reviewer", "A reviewer verified this directly.", "ok"),
	corroborated: e("Independently supported", "An independent source from another document agrees.", "ok"),
	conflicting: e("Conflicting evidence", "Evidence disagrees. Resolve it before sharing these figures.", "bad"),
	supplied_by_founder: e("Provided by you, in a document", "Your own document says so. A document is not proof; no independent source has been compared.", "caution"),
	source_cited: e("Source cited, not checked", "A source is cited; the system has not fetched or checked it.", "caution"),
	founder_assertion: e("Provided by you only", "Your own statement with no supporting evidence linked.", "caution"),
};
export const BASIS: Record<string, string> = {
	founder_assertion: "Our own statement",
	uploaded_document: "An uploaded document",
	official_public_source: "An official public source",
	third_party_source: "A third-party source",
};

/** Where candidate investors come from. The list is never the whole market. */
export const UNIVERSE: Record<string, string> = { published_profile: "Published by the firm", workspace_research: "From your workspace's research" };

export const ACTION_KIND: Record<string, { label: string; verb: string }> = {
	confirm_mismatch: { label: "Confirm", verb: "Check before dropping this investor" },
	clarify_profile: { label: "Clarify", verb: "Add to your profile" },
	review_criterion: { label: "Review", verb: "Check the source" },
	add_evidence: { label: "Evidence", verb: "Add or fix evidence" },
	re_evaluate: { label: "Re-run", verb: "Update the evaluation" },
};

/** Research on an investor. "Incomplete" and "nothing found" are different statements. */
export const RESEARCH: Record<string, Entry> = {
	pending: e("Not researched yet", "A profile exists but no research has run.", "unknown"),
	thesis_found: e("Criteria found", "At least one criterion was stated on the firm's own pages.", "ok"),
	no_thesis_found: e("Read, nothing stated", "The pages that could be read state no criteria. That does not mean the firm has none.", "unknown"),
	research_incomplete: e("Research incomplete", "Pages were blocked, failed or too few could be read. Nothing can be concluded yet. Try again.", "caution"),
};

/** A representative's claim: three separate states. */
export const CLAIM: Record<string, Entry> = {
	requested: e("Claim submitted", "Next: publish the challenge on the firm's website and check it.", "neutral"),
	proof_ok: e("Domain proof found", "Control of the website is shown. A moderator still decides whether you may represent the firm.", "caution"),
	proof_failed: e("Domain proof not found", "The challenge was not found at the expected address. Check it and try again.", "caution"),
	verified: e("Verified by a moderator", "You may approve and publish the firm's criteria.", "ok"),
	rejected: e("Claim rejected", "A moderator rejected this claim. The reason is in the history.", "bad"),
	revoked: e("Verification revoked", "A moderator withdrew your authority. Published criteria were withdrawn.", "bad"),
};

export const LIFECYCLE: Record<string, Entry> = {
	proposed: e("Proposed", "Not yet reviewed by a person.", "neutral"),
	needs_review: e("Needs review", "Flagged for a person to look at.", "caution"),
	accepted: e("Accepted as evidence", "A person judged the evidence sound. This is not approval by the firm.", "ok"),
	rejected: e("Rejected", "A person set it aside. It is kept in the history.", "bad"),
	disputed: e("Disputed", "A person challenged it. It stays visible with the reason.", "caution"),
	superseded: e("Replaced", "A newer version from the same source replaced it.", "neutral"),
};

export const SOURCE_CATEGORY: Record<string, string> = {
	investor_verified: "Approved by the firm",
	official_public_source: "Firm's own site",
	third_party_source: "External source",
	founder_contribution: "Founder contribution",
	community_contribution: "Community contribution",
};

export const SHORTLIST_STATUS = [
	{ value: "considering", label: "Considering" },
	{ value: "ready", label: "Ready to approach (your decision)" },
	{ value: "parked", label: "Parked" },
	{ value: "ruled_out", label: "Ruled out" },
];

/** A glyph that carries the tone without colour, so a status survives greyscale. */
export const TONE_MARK: Record<Tone, string> = { ok: "✓", caution: "!", bad: "✕", unknown: "?", neutral: "•" };

export function entry(table: Record<string, Entry>, key: string): Entry {
	return table[key] ?? { label: key.replace(/_/g, " "), help: "", tone: "neutral" };
}
