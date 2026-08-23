// ---------------------------------------------------------------------------
// Incident Graph / Correlation Engine
//
// Every observation is an independent event. This module decides whether a
// new observation represents the SAME real-world incident as one or more
// existing open incidents, or a new one — by scoring independent signals
// (no reliance on a single continuous camera or a shared plate read):
//
//   time proximity, spatial proximity, direction/trajectory, scene
//   similarity, vehicle appearance/fingerprint, and incident-type match.
//
// This is what turns fragmented, asynchronous, heterogeneous observations
// (a citizen phone at 08:42:03, a dashcam at 08:42:11, an authorized sensor
// at 08:42:18) into ONE incident graph rather than three unrelated reports.
// ---------------------------------------------------------------------------

import { bearingDelta, distanceMeters } from "@/lib/geo";
import { sceneSimilarity } from "@/lib/ai/vision";
import type { CorrelationFactors, ObservationLite } from "@/lib/types";

export interface CorrelationCandidate {
  incidentId: string;
  incidentType: string;
  roadSegmentId: string | null;
  /** The most recent observation already linked to this incident, used as the comparison anchor. */
  anchorObservation: ObservationLite;
}

export interface CorrelationResult {
  incidentId: string | null; // null => start a new incident
  score: number;
  factors: CorrelationFactors;
  explanation: string;
}

const WEIGHTS = {
  temporal: 0.22,
  spatial: 0.28,
  trajectory: 0.1,
  scene: 0.18,
  appearance: 0.14,
  incidentTypeMatch: 0.08,
};

// Join threshold: a new observation joins the highest-scoring existing
// incident only if its score clears this bar; otherwise a new incident node
// is created. Tuned so accidental co-location of unrelated events doesn't
// merge, while multi-angle observations of the same event do.
export const CORRELATION_JOIN_THRESHOLD = 0.6;

const TEMPORAL_WINDOW_SECONDS = 20 * 60; // observations >20 min apart score ~0 on time
const SPATIAL_WINDOW_METERS = 120; // observations >120m apart score ~0 on space

function temporalScore(a: string, b: string): number {
  const deltaSec = Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 1000;
  return Math.max(0, 1 - deltaSec / TEMPORAL_WINDOW_SECONDS);
}

function spatialScore(a: ObservationLite, b: ObservationLite): number {
  const d = distanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  return Math.max(0, 1 - d / SPATIAL_WINDOW_METERS);
}

function trajectoryScore(a: ObservationLite, b: ObservationLite): number {
  if (a.orientationDeg == null || b.orientationDeg == null) return 0.5; // unknown -> neutral
  const delta = bearingDelta(a.orientationDeg, b.orientationDeg);
  // Same direction (delta ~0) or opposite-facing observer capturing the same
  // event (delta ~180) both score high; perpendicular scores low.
  const aligned = Math.max(1 - delta / 90, 1 - Math.abs(delta - 180) / 90);
  return Math.max(0, Math.min(1, aligned));
}

function appearanceScore(a: ObservationLite, b: ObservationLite): number {
  if (a.vehicleFingerprint && b.vehicleFingerprint) {
    return a.vehicleFingerprint === b.vehicleFingerprint ? 1 : 0.15;
  }
  return 0.5; // insufficient data -> neutral, do not penalize or over-credit
}

export function scoreObservationPair(a: ObservationLite, b: ObservationLite): {
  score: number;
  factors: CorrelationFactors;
} {
  // Hard gate: observations reporting different incident types are never
  // the same incident, no matter how close in time/space — they are
  // different claims about the world and must stay separate graph nodes.
  if (a.incidentTypeGuess !== b.incidentTypeGuess) {
    const factors: CorrelationFactors = { temporal: 0, spatial: 0, trajectory: 0, scene: 0, appearance: 0, incidentTypeMatch: 0 };
    return { score: 0, factors };
  }

  const factors: CorrelationFactors = {
    temporal: temporalScore(a.capturedAt, b.capturedAt),
    spatial: spatialScore(a, b),
    trajectory: trajectoryScore(a, b),
    scene: sceneSimilarity(a.sceneDescriptor, b.sceneDescriptor),
    appearance: appearanceScore(a, b),
    incidentTypeMatch: a.incidentTypeGuess === b.incidentTypeGuess ? 1 : 0.1,
  };

  const score =
    factors.temporal * WEIGHTS.temporal +
    factors.spatial * WEIGHTS.spatial +
    factors.trajectory * WEIGHTS.trajectory +
    factors.scene * WEIGHTS.scene +
    factors.appearance * WEIGHTS.appearance +
    factors.incidentTypeMatch * WEIGHTS.incidentTypeMatch;

  return { score: Math.max(0, Math.min(1, score)), factors };
}

/**
 * Decide which open incident (if any) a new observation should join.
 * Scores against every candidate's anchor observation and picks the best
 * match above the join threshold.
 */
export function correlateObservation(
  newObservation: ObservationLite,
  candidates: CorrelationCandidate[]
): CorrelationResult {
  let best: { candidate: CorrelationCandidate; score: number; factors: CorrelationFactors } | null = null;

  for (const candidate of candidates) {
    const { score, factors } = scoreObservationPair(newObservation, candidate.anchorObservation);
    if (!best || score > best.score) {
      best = { candidate, score, factors };
    }
  }

  if (best && best.score >= CORRELATION_JOIN_THRESHOLD) {
    const f = best.factors;
    return {
      incidentId: best.candidate.incidentId,
      score: best.score,
      factors: f,
      explanation:
        `Joined existing incident: ${(f.temporal * 100).toFixed(0)}% time proximity, ` +
        `${(f.spatial * 100).toFixed(0)}% spatial proximity, ${(f.scene * 100).toFixed(0)}% scene similarity, ` +
        `${(f.appearance * 100).toFixed(0)}% appearance match, ${(f.trajectory * 100).toFixed(0)}% trajectory consistency. ` +
        `Combined correlation score ${(best.score * 100).toFixed(0)}% clears the ${(CORRELATION_JOIN_THRESHOLD * 100).toFixed(0)}% join threshold.`,
    };
  }

  return {
    incidentId: null,
    score: best?.score ?? 0,
    factors:
      best?.factors ?? {
        temporal: 0,
        spatial: 0,
        trajectory: 0,
        scene: 0,
        appearance: 0,
        incidentTypeMatch: 0,
      },
    explanation: best
      ? `Best candidate scored ${(best.score * 100).toFixed(0)}%, below the ${(CORRELATION_JOIN_THRESHOLD * 100).toFixed(0)}% join threshold — treated as a new, independent incident.`
      : "No open incidents nearby in time or space — treated as a new, independent incident.",
  };
}
