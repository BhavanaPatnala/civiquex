// ---------------------------------------------------------------------------
// Character-Level Temporal Consensus + Contradiction Engine
//
// This is the trust core of plate recovery. Every rule here exists to make one
// guarantee enforceable: CiviqueX prefers "UNREADABLE" over "WRONG PLATE".
// False vehicle identification is more dangerous than missing identification,
// so nothing in this file is permitted to complete a plate by inference.
//
// Concretely, statistical agreement alone is never sufficient (§12). A
// majority vote that is only a majority because of a known-confusable glyph
// pair (8/B, 0/O, ...) degrades that position to UNKNOWN_CHAR rather than
// silently resolving it (§13). A disagreement between glyphs that are NOT
// plausibly confusable is treated as a genuine contradiction and escalates the
// whole result to CONFLICTING (§23) — it means two different plates were seen,
// which usually means two different vehicles.
// ---------------------------------------------------------------------------

import {
  UNKNOWN_CHAR,
  type PlateCharacterConsensus,
  type PlateDecision,
  type PlateObservation,
  type PlateReasoning,
} from "@/lib/vision/plateTypes";

/**
 * Glyph groups that genuinely look alike on a degraded plate crop (§13).
 * Disagreement *within* a group is treated as unresolved ambiguity; a
 * disagreement *across* groups is treated as a real contradiction.
 */
export const CONFUSABLE_GROUPS: readonly (readonly string[])[] = [
  ["0", "O", "D", "Q"],
  ["1", "I", "L", "7"],
  ["2", "Z"],
  ["5", "S"],
  ["8", "B"],
  ["6", "G"],
  ["4", "A"],
  ["U", "V"],
  ["M", "N"],
] as const;

const CONFUSABLE_LOOKUP: Map<string, number> = (() => {
  const map = new Map<string, number>();
  CONFUSABLE_GROUPS.forEach((group, i) => group.forEach((ch) => map.set(ch, i)));
  return map;
})();

/** True when two different characters are plausibly the same glyph misread. */
export function areConfusable(a: string, b: string): boolean {
  if (a === b) return true;
  const ga = CONFUSABLE_LOOKUP.get(a);
  const gb = CONFUSABLE_LOOKUP.get(b);
  return ga !== undefined && ga === gb;
}

/** Weighted agreement required before a character position is considered established. */
const CHARACTER_AGREEMENT_THRESHOLD = 0.75;
/** Below this weighted support a position is treated as unsupported regardless of agreement ratio. */
const MIN_ABSOLUTE_CHARACTER_WEIGHT = 0.35;
/** A plate needs at least this share of positions resolved to be worth showing at all. */
const MIN_RESOLVED_RATIO_FOR_PARTIAL = 0.5;
/** Independent agreeing frames required for CONFIRMED — one frame is never enough (§11). */
const MIN_FRAMES_FOR_CONFIRMED = 2;
/** Plate crops narrower than this cannot carry legible characters; never upscale-and-guess (§19). */
export const MIN_PLATE_PIXEL_WIDTH = 64;

export interface ConsensusInput {
  observations: PlateObservation[];
  /** When the vehicle track's identity could not be confirmed, nothing here may reach CONFIRMED (§16). */
  identityUncertain?: boolean;
}

export interface ConsensusOutput {
  plate: string | null;
  characters: PlateCharacterConsensus[];
  decision: PlateDecision;
  reasoning: PlateReasoning[];
  /** 0-1, share of contributing frames that agreed, averaged across resolved positions. */
  agreement: number;
  contributingFrames: number;
}

/** Normalizes an OCR string to the plate alphabet. Anything else is dropped, never substituted. */
export function normalizePlateText(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9?]/g, "");
}

/**
 * How much one observation's vote at a position is worth. Deliberately
 * combines *independent* signals — a confident OCR read off a blurry,
 * low-resolution crop should not outvote a moderate read off a sharp one.
 */
function observationWeight(obs: PlateObservation, charIndex: number): number {
  const charConf = obs.charConfidences[charIndex] ?? obs.ocrConfidence;
  const quality = obs.quality.overall / 100;
  const resolution = Math.min(1, obs.platePixelWidth / (MIN_PLATE_PIXEL_WIDTH * 2));
  return Math.max(0, charConf) * Math.max(0.05, quality) * Math.max(0.05, resolution);
}

/**
 * Runs character-level temporal consensus across independent OCR readings of
 * the same tracked vehicle, and decides how far the evidence actually goes.
 * Never returns a character the source readings did not contain.
 */
export function buildPlateConsensus(input: ConsensusInput): ConsensusOutput {
  const reasoning: PlateReasoning[] = [];

  // Only readings from crops with enough real pixels are admissible. An
  // under-resolution crop is excluded rather than upscaled (§19, §25).
  const legible = input.observations.filter((o) => o.platePixelWidth >= MIN_PLATE_PIXEL_WIDTH);
  const droppedForResolution = input.observations.length - legible.length;
  if (droppedForResolution > 0) {
    reasoning.push({
      code: "RESOLUTION_INSUFFICIENT",
      detail: `${droppedForResolution} frame${droppedForResolution === 1 ? "" : "s"} excluded — the plate region was below ${MIN_PLATE_PIXEL_WIDTH}px wide, too few real pixels to carry characters.`,
    });
  }

  const usable = legible.filter((o) => normalizePlateText(o.text).replace(/\?/g, "").length > 0);
  if (usable.length === 0) {
    reasoning.push({
      code: "NO_READABLE_FRAMES",
      detail: "No frame in this vehicle's track produced a readable plate region.",
    });
    return { plate: null, characters: [], decision: "UNREADABLE", reasoning, agreement: 0, contributingFrames: 0 };
  }

  // Align by plate length. Readings of a different length are not force-fitted
  // — a differing length is itself evidence of disagreement, not something to
  // paper over by stretching one string onto another.
  const lengthVotes = new Map<number, number>();
  for (const o of usable) {
    const len = normalizePlateText(o.text).length;
    lengthVotes.set(len, (lengthVotes.get(len) ?? 0) + 1);
  }
  const consensusLength = [...lengthVotes.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const aligned = usable.filter((o) => normalizePlateText(o.text).length === consensusLength);
  const lengthDissenters = usable.length - aligned.length;

  const characters: PlateCharacterConsensus[] = [];
  let sawHardConflict = false;
  let sawConfusableAmbiguity = false;
  let agreementSum = 0;
  let resolvedCount = 0;

  for (let pos = 0; pos < consensusLength; pos++) {
    const weights = new Map<string, { votes: number; weight: number }>();
    let totalWeight = 0;

    for (const obs of aligned) {
      const ch = normalizePlateText(obs.text)[pos];
      if (!ch || ch === UNKNOWN_CHAR) continue; // an explicit non-read contributes nothing, and invents nothing
      const w = observationWeight(obs, pos);
      const entry = weights.get(ch) ?? { votes: 0, weight: 0 };
      entry.votes += 1;
      entry.weight += w;
      weights.set(ch, entry);
      totalWeight += w;
    }

    const candidates = [...weights.entries()]
      .map(([character, v]) => ({ character, votes: v.votes, weight: v.weight }))
      .sort((a, b) => b.weight - a.weight);

    if (candidates.length === 0 || totalWeight === 0) {
      characters.push({ position: pos, character: UNKNOWN_CHAR, candidates: [], confusableOnly: false, agreement: 0 });
      continue;
    }

    const top = candidates[0];
    const agreement = top.weight / totalWeight;

    // Is every dissenting reading merely a confusable variant of the leader?
    const dissenters = candidates.slice(1);
    const confusableOnly = dissenters.length > 0 && dissenters.every((c) => areConfusable(c.character, top.character));
    const hasHardDisagreement = dissenters.some((c) => !areConfusable(c.character, top.character));

    if (hasHardDisagreement) sawHardConflict = true;

    const established =
      agreement >= CHARACTER_AGREEMENT_THRESHOLD && top.weight >= MIN_ABSOLUTE_CHARACTER_WEIGHT && !hasHardDisagreement;

    if (!established && confusableOnly) sawConfusableAmbiguity = true;

    characters.push({
      position: pos,
      character: established ? top.character : UNKNOWN_CHAR,
      candidates,
      confusableOnly,
      agreement,
    });

    if (established) {
      resolvedCount += 1;
      agreementSum += agreement;
    }
  }

  const plateText = characters.map((c) => c.character).join("");
  const resolvedRatio = consensusLength === 0 ? 0 : resolvedCount / consensusLength;
  const meanAgreement = resolvedCount === 0 ? 0 : agreementSum / resolvedCount;

  if (lengthDissenters > 0) {
    sawHardConflict = true;
    reasoning.push({
      code: "CHARACTER_CONFLICT",
      detail: `${lengthDissenters} reading${lengthDissenters === 1 ? "" : "s"} produced a different plate length — the frames do not agree on the same plate.`,
    });
  }

  // ---- Decision (§24). Ordered most-severe first; nothing falls through to a guess.
  let decision: PlateDecision;

  if (sawHardConflict) {
    decision = "CONFLICTING";
    reasoning.push({
      code: "CHARACTER_CONFLICT",
      detail: "Independent frames disagree on characters that are not plausibly the same glyph — this can indicate two different vehicles in view.",
    });
  } else if (resolvedCount === 0) {
    decision = "UNREADABLE";
    reasoning.push({ code: "NO_READABLE_FRAMES", detail: "No character position had enough agreeing visual support to be established." });
  } else if (input.identityUncertain) {
    decision = "REVIEW_REQUIRED";
    reasoning.push({
      code: "IDENTITY_UNCERTAIN",
      detail: "The vehicle track was interrupted and re-association could not be confirmed — this plate cannot be safely attributed to the offending vehicle.",
    });
  } else if (aligned.length < MIN_FRAMES_FOR_CONFIRMED) {
    decision = resolvedRatio === 1 ? "REVIEW_REQUIRED" : "PARTIALLY_READABLE";
    reasoning.push({
      code: "SINGLE_FRAME_ONLY",
      detail: "Only one frame produced a usable reading — a single OCR result is never treated as confirmed.",
    });
  } else if (resolvedRatio === 1) {
    decision = "CONFIRMED";
    reasoning.push({
      code: "AGREEING_FRAMES",
      detail: `Every character agreed across ${aligned.length} independent frames.`,
    });
  } else if (resolvedRatio >= MIN_RESOLVED_RATIO_FOR_PARTIAL) {
    decision = "PARTIALLY_READABLE";
    if (sawConfusableAmbiguity) {
      reasoning.push({
        code: "CONFUSABLE_AMBIGUITY",
        detail: "Some positions could not be separated between look-alike characters (for example 8 vs B); they are left unresolved rather than guessed.",
      });
    }
  } else {
    decision = "UNREADABLE";
    reasoning.push({
      code: "LOW_FRAME_QUALITY",
      detail: `Only ${resolvedCount} of ${consensusLength} characters had adequate support — too little of the plate is established to report.`,
    });
  }

  const anyResolved = resolvedCount > 0;
  return {
    plate: anyResolved ? plateText : null,
    characters,
    decision,
    reasoning,
    agreement: meanAgreement,
    contributingFrames: aligned.length,
  };
}
