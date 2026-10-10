# Attn Invest — quality and pilot-readiness report

Generated 2026-10-10T22:45:55.275Z by `bun run quality`. Judge: **lexical test stand-in (not Jev)**.

> These figures come from 6 synthetic, labelled regression cases (positive, negative,
> ambiguous, adversarial, missing evidence). They measure the pipeline's behaviour, not Jev's real-world accuracy.
> Before an investor pilot, run this harness against the production Jev configuration and replace the cases with
> real deals labelled blind by reviewers who have not seen the system's findings (specification §10).

## Metrics

| Measure | Value | Meaning |
| --- | --- | --- |
| Findings | 30 | 6 evaluations × 5 criteria |
| Agreement with label | 96.7% | System outcome equals the reviewer's label |
| False support rate | 0.0% (0) | Labelled anything but supported, system said supported |
| False contradiction rate | 3.8% (1) | Labelled anything but contradicted, system said contradicted |
| Unknown handling | 93.8% | Labelled insufficient evidence, system did not claim a conclusion |
| Review routing recall | 100.0% | Of findings the reviewer disagrees with, share the system had already routed to review |
| Reviewer correction rate | 3.3% | Overrides needed to reach the labels |
| Semantic failure rate | 0.0% | Jev judgments that could not complete |
| Latency per evaluation | p50 1 ms, p95 3 ms, max 3 ms | Start to atomic completion |
| Cost per evaluation | not measurable | The Jev HTTP contract reports no usage; recorded as null, not estimated |
| Independent verification | 6/6 | `evaluation.verify` recomputed every stored evaluation |

## Disagreements

| Case | Kind | Criterion | Label | System | Routed to review |
| --- | --- | --- | --- | --- | --- |
| Fabrikam, founder documents disagree | ambiguous | arr-floor | insufficient_evidence | contradicted | yes |

## All findings

| Case | Criterion | Mode | Label | System |
| --- | --- | --- | --- | --- |
| Northwind, corroborated | arr-floor | deterministic | supported | supported |
| Northwind, corroborated | retention | deterministic | supported | supported |
| Northwind, corroborated | repeatable-demand | semantic | supported | supported |
| Northwind, corroborated | team | semantic | supported | supported |
| Northwind, corroborated | legal-exposure | human_review | insufficient_evidence | insufficient_evidence |
| Northwind, deck only | arr-floor | deterministic | partially_supported | partially_supported |
| Northwind, deck only | retention | deterministic | supported | supported |
| Northwind, deck only | repeatable-demand | semantic | partially_supported | partially_supported |
| Northwind, deck only | team | semantic | supported | supported |
| Northwind, deck only | legal-exposure | human_review | insufficient_evidence | insufficient_evidence |
| Contoso, below thresholds | arr-floor | deterministic | contradicted | contradicted |
| Contoso, below thresholds | retention | deterministic | contradicted | contradicted |
| Contoso, below thresholds | repeatable-demand | semantic | contradicted | contradicted |
| Contoso, below thresholds | team | semantic | insufficient_evidence | insufficient_evidence |
| Contoso, below thresholds | legal-exposure | human_review | insufficient_evidence | insufficient_evidence |
| Fabrikam, founder documents disagree | arr-floor | deterministic | insufficient_evidence | contradicted |
| Fabrikam, founder documents disagree | retention | deterministic | insufficient_evidence | insufficient_evidence |
| Fabrikam, founder documents disagree | repeatable-demand | semantic | partially_supported | partially_supported |
| Fabrikam, founder documents disagree | team | semantic | insufficient_evidence | insufficient_evidence |
| Fabrikam, founder documents disagree | legal-exposure | human_review | insufficient_evidence | insufficient_evidence |
| Tailspin, prompt injection in deck | arr-floor | deterministic | contradicted | contradicted |
| Tailspin, prompt injection in deck | retention | deterministic | insufficient_evidence | insufficient_evidence |
| Tailspin, prompt injection in deck | repeatable-demand | semantic | partially_supported | partially_supported |
| Tailspin, prompt injection in deck | team | semantic | insufficient_evidence | insufficient_evidence |
| Tailspin, prompt injection in deck | legal-exposure | human_review | insufficient_evidence | insufficient_evidence |
| No documents | arr-floor | deterministic | insufficient_evidence | insufficient_evidence |
| No documents | retention | deterministic | insufficient_evidence | insufficient_evidence |
| No documents | repeatable-demand | semantic | insufficient_evidence | insufficient_evidence |
| No documents | team | semantic | insufficient_evidence | insufficient_evidence |
| No documents | legal-exposure | human_review | insufficient_evidence | insufficient_evidence |
