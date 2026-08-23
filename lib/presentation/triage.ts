// ---------------------------------------------------------------------------
// Presentation-layer mapping from the real engine outputs (rule verdict +
// decomposed evidence confidence — see lib/engines/rules.ts and
// lib/engines/confidence.ts) onto CiviqueX's three-way triage language. This is
// a renaming/derivation layer, not a new AI capability: every value here is
// computed from data the pipeline already produces.
// ---------------------------------------------------------------------------

export type Triage = "action_ready" | "review_required" | "insufficient";

// Plain-language only — never a percentage, never a model term. A citizen or
// officer should be able to act on this word alone.
export const TRIAGE_LABEL: Record<Triage, string> = {
  action_ready: "Strong evidence",
  review_required: "Review required",
  insufficient: "Insufficient evidence",
};

export function deriveTriage(ruleVerdict: string, evidenceConfidenceOverall: number): Triage {
  if (ruleVerdict === "evidence_insufficient") return "insufficient";
  if (ruleVerdict === "potential_violation" && evidenceConfidenceOverall >= 0.82) return "action_ready";
  return "review_required";
}

/** 0-1 overall confidence, presented as CiviqueX's "Evidence score" out of 100 — never called "accuracy." */
export function evidenceScoreOf(overall: number): string {
  return (overall * 100).toFixed(1);
}

export interface VerificationItem {
  label: string;
  passed: boolean;
}

/**
 * The "Why was this verified?" checklist — each line is a real threshold
 * read directly off the decomposed confidence breakdown, not a fabricated
 * claim. A factor below threshold shows as unverified, never hidden.
 */
export function verificationChecklist(breakdown: {
  visual: number;
  location: number;
  temporal: number;
  rule: number;
  scene: number;
  corroboration: number;
}): VerificationItem[] {
  return [
    { label: "Vehicle/scene identity established", passed: breakdown.visual >= 0.7 },
    { label: "Location verified", passed: breakdown.location >= 0.7 },
    { label: "Timestamp verified", passed: breakdown.temporal >= 0.7 },
    { label: "Applicable rule identified", passed: breakdown.rule >= 0.7 },
    { label: "Road/scene context established", passed: breakdown.scene >= 0.7 },
    { label: "Corroborated by an independent observation", passed: breakdown.corroboration >= 0.5 },
  ];
}
