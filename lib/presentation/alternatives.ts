// ---------------------------------------------------------------------------
// "Alternative explanations checked" — CiviqueX's contradiction-testing section.
// Every line here is derived from real, already-computed pipeline data
// (the rule engine's context checks, the confidence breakdown, corroboration
// count) — this is a presentation layer, not a new detection capability.
// Where the underlying engine has no real signal for a scenario, it is
// deliberately left out rather than shown as "ruled out" with nothing behind it.
// ---------------------------------------------------------------------------

import type { EvidenceConfidenceBreakdown } from "@/lib/types";

export interface AlternativeCheck {
  label: string;
  ruledOut: boolean;
  detail: string;
}

// The rule engine's raw check detail can carry numbers ("Visual quality 79%,
// avg detection confidence 88%") — real and useful in an audit log, but a
// number a user has to interpret is exactly what this screen must never
// show. Re-derive a plain sentence from the check's own label instead of
// touching the raw string.
function plainContextDetail(label: string, passed: boolean): string {
  if (label.startsWith("Codified rule lookup")) return passed ? "A matching rule was found." : "No matching rule was found for this type of report.";
  if (label.startsWith("Visual evidence quality")) return passed ? "The recording was clear enough to review." : "The recording was not clear enough to review confidently.";
  if (label.startsWith("Temporal window")) return passed ? "This happened during a restricted time window." : "This did not happen during a restricted time window.";
  if (label.startsWith("Road class")) return passed ? "The road type matches where this rule applies." : "The road type does not clearly match where this rule applies.";
  if (label.startsWith("School proximity")) return passed ? "A school zone was confirmed nearby." : "No school zone was confirmed nearby.";
  if (label.startsWith("Hospital")) return passed ? "A hospital or emergency access point was confirmed nearby." : "No hospital or emergency access point was confirmed nearby.";
  if (label.startsWith("Minimum visual confidence")) return passed ? "What was detected was clear enough to act on." : "What was detected was not clear enough to act on alone.";
  return passed ? "Confirmed." : "Could not be confirmed.";
}

export function alternativeExplanations(input: {
  breakdown: EvidenceConfidenceBreakdown;
  corroboratingObservations: number;
  contextChecks: { label: string; passed: boolean; detail: string }[];
}): AlternativeCheck[] {
  const checks: AlternativeCheck[] = [];

  // The rule/context engine's own gating checks ARE alternative-explanation
  // testing in substance: each one asks "could this be legal/explainable
  // given where and when it happened?" before allowing a violation verdict.
  for (const c of input.contextChecks) {
    checks.push({ label: c.label.replace(/\s*\([A-Z0-9-]+\)$/, ""), ruledOut: c.passed, detail: plainContextDetail(c.label, c.passed) });
  }

  checks.push({
    label: "Camera perspective / misclassification",
    ruledOut: input.breakdown.visual >= 0.7 && input.breakdown.scene >= 0.7,
    detail:
      input.breakdown.visual >= 0.7 && input.breakdown.scene >= 0.7
        ? "Visual and scene confidence are both high — a perspective-driven misread is unlikely."
        : "Visual or scene confidence is not high enough to rule this out with confidence.",
  });

  checks.push({
    label: "Incorrect vehicle association",
    ruledOut: input.corroboratingObservations > 0 || input.breakdown.visual >= 0.8,
    detail:
      input.corroboratingObservations > 0
        ? `Vehicle identity held consistent across ${input.corroboratingObservations} independent corroborating observation(s).`
        : input.breakdown.visual >= 0.8
          ? "Single observation, but visual identification confidence is high."
          : "Only one observation, with moderate visual confidence — association is not independently confirmed.",
  });

  return checks;
}

export function unresolvedCount(checks: AlternativeCheck[]): number {
  return checks.filter((c) => !c.ruledOut).length;
}
