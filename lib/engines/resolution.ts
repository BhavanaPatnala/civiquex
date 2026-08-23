// ---------------------------------------------------------------------------
// Resolution Verification Engine
//
// An authority marking an incident "resolved" is a claim, not a fact. This
// engine independently compares the original ("before") evidence against
// the latest ("after") observation of the same location to decide whether
// the physical-world problem actually went away — scene similarity, object
// presence, and obstruction state, not the authority's self-report.
// ---------------------------------------------------------------------------

import { sceneSimilarity } from "@/lib/ai/vision";
import type { DetectionLike } from "@/lib/types";

export type ResolutionResult = "likely_resolved" | "still_present" | "inconclusive";

export interface ResolutionCheckInput {
  beforeDetections: DetectionLike[];
  afterDetections: DetectionLike[] | null; // null => no fresh observation available yet
  beforeSceneDescriptor: number[];
  afterSceneDescriptor: number[] | null;
  offendingLabels: string[]; // e.g. ["parked_vehicle"] — the object class(es) that constituted the obstruction
}

export interface ResolutionCheckResult {
  result: ResolutionResult;
  confidence: number;
  similarityScore: number | null;
  objectPresenceDelta: { label: string; presentBefore: boolean; presentAfter: boolean | null }[];
  explanation: string;
}

function hasLabel(detections: DetectionLike[], label: string, minConfidence = 0.5): boolean {
  return detections.some((d) => d.label === label && d.confidence >= minConfidence);
}

export function checkResolution(input: ResolutionCheckInput): ResolutionCheckResult {
  const objectPresenceDelta = input.offendingLabels.map((label) => ({
    label,
    presentBefore: hasLabel(input.beforeDetections, label),
    presentAfter: input.afterDetections ? hasLabel(input.afterDetections, label) : null,
  }));

  if (!input.afterDetections || !input.afterSceneDescriptor) {
    return {
      result: "inconclusive",
      confidence: 0,
      similarityScore: null,
      objectPresenceDelta,
      explanation: "No fresh observation of this location is available yet. Independent verification is pending — the authority's status is not treated as ground truth until a new observation arrives.",
    };
  }

  const similarityScore = sceneSimilarity(input.beforeSceneDescriptor, input.afterSceneDescriptor);
  const stillObstructed = objectPresenceDelta.some((d) => d.presentBefore && d.presentAfter);
  const clearedAll = objectPresenceDelta.every((d) => d.presentBefore && d.presentAfter === false);

  if (stillObstructed) {
    // Scene stayed similar AND the offending object is still detected: high-confidence "still present".
    const confidence = Math.min(0.97, 0.55 + similarityScore * 0.4);
    return {
      result: "still_present",
      confidence,
      similarityScore,
      objectPresenceDelta,
      explanation: `The obstructing object (${objectPresenceDelta.filter((d) => d.presentBefore && d.presentAfter).map((d) => d.label).join(", ")}) is still detected in the latest observation, with ${(similarityScore * 100).toFixed(0)}% scene similarity to the original evidence. The issue does not appear to be resolved.`,
    };
  }

  if (clearedAll) {
    // Object gone; scene similarity should be moderate (same place, different state) rather than
    // near-identical (which would suggest the "after" shot is stale/reused) or near-zero (wrong location).
    const wellFormed = similarityScore > 0.3 && similarityScore < 0.93;
    const confidence = wellFormed ? Math.min(0.97, 0.6 + (1 - Math.abs(similarityScore - 0.6)) * 0.4) : 0.4;
    return {
      result: wellFormed ? "likely_resolved" : "inconclusive",
      confidence,
      similarityScore,
      objectPresenceDelta,
      explanation: wellFormed
        ? `The obstructing object is no longer detected at the same location (${(similarityScore * 100).toFixed(0)}% scene similarity — same place, changed state). Likely resolved, pending continued monitoring.`
        : `The obstructing object is no longer detected, but the scene similarity (${(similarityScore * 100).toFixed(0)}%) is outside the expected range for a genuine same-location recheck — flagged for manual confirmation rather than auto-closing.`,
      };
  }

  return {
    result: "inconclusive",
    confidence: 0.35,
    similarityScore,
    objectPresenceDelta,
    explanation: "Object presence signal is ambiguous. Requires an additional observation before a resolution determination can be made.",
  };
}
