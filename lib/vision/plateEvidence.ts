// ---------------------------------------------------------------------------
// Evidence Sufficiency Engine (§20) + Adversarial Self-Check (§19)
//
// The decision layer. Its job is NOT to report what OCR said with a confidence
// number attached — it is to ask whether the available evidence is strong
// enough to act on, and to actively try to disprove its own conclusion before
// allowing CONFIRMED.
//
// Prior art, stated plainly (§35): none of the individual ingredients here are
// novel — multi-frame fusion, temporal OCR voting, IoU tracking and confidence
// calibration are all long-established. What is assembled here is the specific
// decision architecture: independent evidence dimensions, an explicit
// identity lock, a contradiction pass, and a bias toward abstention.
// ---------------------------------------------------------------------------

import { buildPlateConsensus, MIN_PLATE_PIXEL_WIDTH, type ConsensusOutput } from "@/lib/vision/plateConsensus";
import {
  PROCESSING_VERSIONS,
  UNKNOWN_CHAR,
  type PlateEvidenceBreakdown,
  type PlateObservation,
  type PlateReasoning,
  type PlateRecoveryResult,
  type VehicleTrack,
} from "@/lib/vision/plateTypes";

/** Weights across independent evidence dimensions. Interpretable by design (§22) — not a learned blend. */
const EVIDENCE_WEIGHTS: PlateEvidenceBreakdown = {
  detection: 0.1,
  tracking: 0.15,
  localization: 0.1,
  imageQuality: 0.15,
  ocrAgreement: 0.2,
  temporalConsistency: 0.15,
  identity: 0.15,
};

/** Evidence quality below this cannot be CONFIRMED regardless of character agreement. */
const MIN_QUALITY_FOR_CONFIRMED = 70;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Groups near-duplicate observations so a camera that produced twenty nearly
 * identical frames cannot inflate apparent corroboration (§4). Two readings
 * are treated as one piece of evidence when they say the same thing from
 * adjacent frames at similar quality.
 */
export function countIndependentObservations(observations: PlateObservation[]): number {
  if (observations.length === 0) return 0;
  const sorted = [...observations].sort((a, b) => a.provenance.sourceTimeSeconds - b.provenance.sourceTimeSeconds);
  let clusters = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const dt = Math.abs(cur.provenance.sourceTimeSeconds - prev.provenance.sourceTimeSeconds);
    const sameText = cur.text === prev.text;
    const similarQuality = Math.abs(cur.quality.overall - prev.quality.overall) < 8;
    // Consecutive, identical, equally-clean frames are one observation of the
    // same instant — not independent corroboration.
    const isRedundant = dt < 0.15 && sameText && similarQuality;
    if (!isRedundant) clusters++;
  }
  return clusters;
}

export interface SufficiencyInput {
  track: VehicleTrack;
  observations: PlateObservation[];
  /** Observations whose plate box failed the geometric identity lock (§14). */
  rejectedForGeometry?: number;
}

/**
 * Runs the adversarial self-check (§19). Each entry is a question that, if
 * left unresolved, blocks CONFIRMED. Returns the unresolved concerns.
 */
export function adversarialSelfCheck(input: SufficiencyInput, consensus: ConsensusOutput): PlateReasoning[] {
  const concerns: PlateReasoning[] = [];
  const { track, observations } = input;

  // Could the vehicle track have switched?
  if (track.identityUncertain) {
    concerns.push({
      code: "IDENTITY_UNCERTAIN",
      detail: "Could this plate belong to a different vehicle? The track was ambiguous at least once, so that cannot be ruled out.",
    });
  }

  // Could OCR have mistaken a look-alike character?
  const confusablePositions = consensus.characters.filter((c) => c.character === UNKNOWN_CHAR && c.confusableOnly);
  if (confusablePositions.length > 0) {
    concerns.push({
      code: "CONFUSABLE_AMBIGUITY",
      detail: `Could a look-alike character explain position${confusablePositions.length === 1 ? "" : "s"} ${confusablePositions
        .map((c) => c.position + 1)
        .join(", ")}? The pixels do not settle it, so ${confusablePositions.length === 1 ? "it is" : "they are"} left unresolved.`,
    });
  }

  // Could glare or blur be hiding a different character?
  const poorFrames = observations.filter((o) => o.quality.glare < 0.5 || o.quality.motionBlur < 0.4);
  if (poorFrames.length > 0 && poorFrames.length === observations.length) {
    concerns.push({
      code: "LOW_FRAME_QUALITY",
      detail: "Could glare or motion blur be concealing a character? Every contributing frame was degraded, so this cannot be excluded.",
    });
  }

  // Could the plate crop be wrong (belonging to another vehicle in shot)?
  if ((input.rejectedForGeometry ?? 0) > 0) {
    concerns.push({
      code: "IDENTITY_UNCERTAIN",
      detail: `${input.rejectedForGeometry} candidate plate region${input.rejectedForGeometry === 1 ? "" : "s"} sat outside this vehicle's outline and ${input.rejectedForGeometry === 1 ? "was" : "were"} discarded — another vehicle's plate was visible nearby.`,
    });
  }

  // Is this really independent corroboration, or one moment repeated?
  if (countIndependentObservations(observations) < 2 && observations.length > 1) {
    concerns.push({
      code: "SINGLE_FRAME_ONLY",
      detail: "Are these genuinely independent observations? They are near-duplicates of the same instant, so they do not corroborate each other.",
    });
  }

  return concerns;
}

/** Combines independent evidence dimensions into an interpretable 0-100 score plus a final decision. */
export function assessPlateEvidence(input: SufficiencyInput): PlateRecoveryResult {
  const { track, observations } = input;

  const consensus = buildPlateConsensus({
    observations,
    identityUncertain: track.identityUncertain,
  });

  const independentCount = countIndependentObservations(observations);

  const breakdown: PlateEvidenceBreakdown = {
    detection: clamp01(mean(track.sightings.map((s) => s.confidence))),
    // Continuity: a track seen across many frames without a bridged gap is stronger.
    tracking: clamp01((track.sightings.length >= 3 ? 0.7 : 0.4) + (track.hadOcclusionGap ? 0 : 0.3)),
    localization: clamp01(observations.length === 0 ? 0 : mean(observations.map((o) => Math.min(1, o.platePixelWidth / (MIN_PLATE_PIXEL_WIDTH * 2))))),
    imageQuality: clamp01(observations.length === 0 ? 0 : mean(observations.map((o) => o.quality.overall / 100))),
    ocrAgreement: clamp01(consensus.agreement),
    // Independent moments matter, not raw frame count (§4).
    temporalConsistency: clamp01(1 - 1 / (1 + independentCount * 0.9)),
    identity: track.identityUncertain ? 0.25 : clamp01(0.6 + (track.hadOcclusionGap ? 0 : 0.4)),
  };

  const evidenceQuality =
    (breakdown.detection * EVIDENCE_WEIGHTS.detection +
      breakdown.tracking * EVIDENCE_WEIGHTS.tracking +
      breakdown.localization * EVIDENCE_WEIGHTS.localization +
      breakdown.imageQuality * EVIDENCE_WEIGHTS.imageQuality +
      breakdown.ocrAgreement * EVIDENCE_WEIGHTS.ocrAgreement +
      breakdown.temporalConsistency * EVIDENCE_WEIGHTS.temporalConsistency +
      breakdown.identity * EVIDENCE_WEIGHTS.identity) *
    100;

  const concerns = adversarialSelfCheck(input, consensus);
  const reasoning: PlateReasoning[] = [...consensus.reasoning];

  let decision = consensus.decision;

  // The self-check can only ever make the outcome MORE conservative (§19, §23).
  if (decision === "CONFIRMED") {
    if (concerns.length > 0) {
      decision = "REVIEW_REQUIRED";
      reasoning.push(...concerns);
    } else if (evidenceQuality < MIN_QUALITY_FOR_CONFIRMED) {
      decision = "REVIEW_REQUIRED";
      reasoning.push({
        code: "LOW_FRAME_QUALITY",
        detail: `Characters agreed, but overall evidence quality (${evidenceQuality.toFixed(0)}/100) is below the bar for automatic confirmation.`,
      });
    } else if (independentCount < 2) {
      decision = "REVIEW_REQUIRED";
      reasoning.push({
        code: "SINGLE_FRAME_ONLY",
        detail: "Confirmation requires agreement across genuinely independent observations.",
      });
    }
  } else if (concerns.length > 0) {
    reasoning.push(...concerns);
  }

  const ranked = [...observations].sort((a, b) => b.quality.overall - a.quality.overall);

  return {
    trackId: track.trackId,
    decision,
    plate: consensus.plate,
    characters: consensus.characters,
    reasoning,
    breakdown,
    evidenceQuality: Math.round(evidenceQuality * 10) / 10,
    bestFrame: ranked[0]?.provenance ?? null,
    supportingFrames: ranked.map((o) => o.provenance),
    versions: PROCESSING_VERSIONS,
  };
}

/**
 * Plain-language explanation for the reviewing officer (§26, §35). Deliberately
 * free of model internals — it states what was observed and why the system did
 * or did not consider that sufficient.
 */
export function explainPlateDecision(result: PlateRecoveryResult): string[] {
  const lines: string[] = [];
  const resolved = result.characters.filter((c) => c.character !== UNKNOWN_CHAR).length;
  const total = result.characters.length;

  lines.push(`${result.supportingFrames.length} usable plate observation${result.supportingFrames.length === 1 ? "" : "s"} from this vehicle's track.`);
  if (total > 0) lines.push(`Character agreement: ${resolved}/${total}.`);
  lines.push(
    result.breakdown.identity >= 0.9
      ? "Plate-to-vehicle association: verified against the tracked vehicle's outline."
      : result.breakdown.identity <= 0.3
        ? "Plate-to-vehicle association: NOT established — the track was ambiguous."
        : "Plate-to-vehicle association: partially established."
  );
  lines.push(`Evidence quality: ${result.evidenceQuality}/100.`);
  for (const r of result.reasoning) lines.push(r.detail);
  return lines;
}
