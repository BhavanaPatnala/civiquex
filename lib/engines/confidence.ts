// ---------------------------------------------------------------------------
// Evidence Confidence Engine
//
// Never reduce evidence quality to a single opaque number presented as fact.
// Confidence is decomposed into independent factors, each individually
// explainable, then combined into an overall score that is still labeled as
// a probability of a "potential violation" — never a legal determination.
// ---------------------------------------------------------------------------

import type { EvidenceConfidenceBreakdown } from "@/lib/types";

export interface ConfidenceInput {
  visualQuality: number; // 0-1, from the vision pipeline
  avgDetectionConfidence: number; // 0-1
  roadSegmentMatched: boolean;
  gpsAccuracyMeters: number; // lower is better
  uploadDelaySeconds: number; // time between capture and upload; large delay lowers temporal trust
  ruleConfidence: number; // 0-1, from the rule engine
  corroboratingObservationCount: number; // additional independent observations linked to the same incident
}

export interface ConfidenceResult {
  breakdown: EvidenceConfidenceBreakdown;
  overall: number;
  label: "strong" | "moderate" | "insufficient";
  explanation: { factor: keyof EvidenceConfidenceBreakdown; value: number; detail: string }[];
}

const WEIGHTS: EvidenceConfidenceBreakdown = {
  visual: 0.2,
  location: 0.15,
  temporal: 0.15,
  rule: 0.2,
  scene: 0.13,
  corroboration: 0.17,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function computeEvidenceConfidence(input: ConfidenceInput): ConfidenceResult {
  const visual = clamp01(input.visualQuality * 0.55 + input.avgDetectionConfidence * 0.45);

  const location = clamp01(
    (input.roadSegmentMatched ? 0.6 : 0.3) + clamp01(1 - input.gpsAccuracyMeters / 40) * 0.4
  );

  const temporal = clamp01(1 - input.uploadDelaySeconds / 900);

  const rule = clamp01(input.ruleConfidence);

  const scene = clamp01(input.visualQuality * 0.7 + input.avgDetectionConfidence * 0.3);

  // Saturating corroboration curve: 0 extra observations -> 0.5 (single,
  // unverified), each additional independent observation adds diminishing value.
  const corroboration = clamp01(1 - 1 / (1 + input.corroboratingObservationCount * 1.4));

  const breakdown: EvidenceConfidenceBreakdown = { visual, location, temporal, rule, scene, corroboration };

  const overall = clamp01(
    breakdown.visual * WEIGHTS.visual +
      breakdown.location * WEIGHTS.location +
      breakdown.temporal * WEIGHTS.temporal +
      breakdown.rule * WEIGHTS.rule +
      breakdown.scene * WEIGHTS.scene +
      breakdown.corroboration * WEIGHTS.corroboration
  );

  const label: ConfidenceResult["label"] = overall >= 0.82 ? "strong" : overall >= 0.6 ? "moderate" : "insufficient";

  const explanation: ConfidenceResult["explanation"] = [
    {
      factor: "visual",
      value: visual,
      detail: `Visual quality ${(input.visualQuality * 100).toFixed(0)}%, detection confidence ${(input.avgDetectionConfidence * 100).toFixed(0)}%`,
    },
    {
      factor: "location",
      value: location,
      detail: input.roadSegmentMatched
        ? `Matched to a known road segment, GPS accuracy ~${input.gpsAccuracyMeters.toFixed(0)}m`
        : `Not matched to a known road segment, GPS accuracy ~${input.gpsAccuracyMeters.toFixed(0)}m`,
    },
    {
      factor: "temporal",
      value: temporal,
      detail:
        input.uploadDelaySeconds < 30
          ? "Uploaded immediately after capture"
          : `Uploaded ${Math.round(input.uploadDelaySeconds / 60)} min after capture`,
    },
    { factor: "rule", value: rule, detail: "Confidence that the applicable regulation was correctly matched to this context" },
    { factor: "scene", value: scene, detail: "Clarity of the surrounding scene (signage, road markings, obstruction extent)" },
    {
      factor: "corroboration",
      value: corroboration,
      detail:
        input.corroboratingObservationCount === 0
          ? "Single observation — not yet corroborated by an independent observer or sensor"
          : `Corroborated by ${input.corroboratingObservationCount} additional independent observation${input.corroboratingObservationCount === 1 ? "" : "s"}`,
    },
  ];

  return { breakdown, overall, label, explanation };
}
