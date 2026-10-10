import type { Outcome, SourceType } from "../domain/types.ts";
import { ADVERSARIAL_DECK, CONTOSO_DECK, FABRIKAM_DECK, FABRIKAM_FINANCIALS, NORTHWIND_AUDIT, NORTHWIND_DECK } from "../testing/fixtures.ts";

/**
 * Labelled regression cases against SEED_SAAS_CRITERIA. Each label is the outcome a careful human
 * reviewer would record from these documents alone, written before looking at system output.
 * They are synthetic fixtures for regression, not a blinded pilot set: a pilot needs real deals
 * labelled by people who have not seen the system's findings.
 */
export type QualityCase = {
	name: string;
	kind: "positive" | "negative" | "ambiguous" | "adversarial" | "missing";
	docs: { bytes: Uint8Array; filename: string; sourceType: SourceType }[];
	founderClaims?: string[];
	labels: Record<string, Outcome>;
};

export const QUALITY_CASES: QualityCase[] = [
	{
		name: "Northwind, corroborated",
		kind: "positive",
		docs: [
			{ bytes: NORTHWIND_DECK, filename: "deck.pdf", sourceType: "founder_deck" },
			{ bytes: NORTHWIND_AUDIT, filename: "review.pdf", sourceType: "third_party_report" },
		],
		labels: { "arr-floor": "supported", retention: "supported", "repeatable-demand": "supported", team: "supported", "legal-exposure": "insufficient_evidence" },
	},
	{
		name: "Northwind, deck only",
		kind: "ambiguous",
		docs: [{ bytes: NORTHWIND_DECK, filename: "deck.pdf", sourceType: "founder_deck" }],
		labels: { "arr-floor": "partially_supported", retention: "supported", "repeatable-demand": "partially_supported", team: "supported", "legal-exposure": "insufficient_evidence" },
	},
	{
		name: "Contoso, below thresholds",
		kind: "negative",
		docs: [{ bytes: CONTOSO_DECK, filename: "deck.pdf", sourceType: "founder_deck" }],
		labels: { "arr-floor": "contradicted", retention: "contradicted", "repeatable-demand": "contradicted", team: "insufficient_evidence", "legal-exposure": "insufficient_evidence" },
	},
	{
		name: "Fabrikam, founder documents disagree",
		kind: "ambiguous",
		docs: [
			{ bytes: FABRIKAM_DECK, filename: "deck.pdf", sourceType: "founder_deck" },
			{ bytes: FABRIKAM_FINANCIALS, filename: "accounts.pdf", sourceType: "founder_financials" },
		],
		labels: { "arr-floor": "insufficient_evidence", retention: "insufficient_evidence", "repeatable-demand": "partially_supported", team: "insufficient_evidence", "legal-exposure": "insufficient_evidence" },
	},
	{
		name: "Tailspin, prompt injection in deck",
		kind: "adversarial",
		docs: [{ bytes: ADVERSARIAL_DECK, filename: "deck.pdf", sourceType: "founder_deck" }],
		labels: { "arr-floor": "contradicted", retention: "insufficient_evidence", "repeatable-demand": "partially_supported", team: "insufficient_evidence", "legal-exposure": "insufficient_evidence" },
	},
	{
		name: "No documents",
		kind: "missing",
		docs: [],
		founderClaims: ["We are growing fast"],
		labels: { "arr-floor": "insufficient_evidence", retention: "insufficient_evidence", "repeatable-demand": "insufficient_evidence", team: "insufficient_evidence", "legal-exposure": "insufficient_evidence" },
	},
];
