// ---------------------------------------------------------------------------
// Temporal Vehicle Identity + Plate Evidence Recovery — shared types.
//
// The question this subsystem answers is NOT "what characters are visible in
// this frame?" but "across the available original video evidence, what is the
// strongest defensible identification of the vehicle that committed this
// incident?" — which is why every type here carries provenance (which frames,
// which crops, which model versions) rather than just a string.
//
// Non-negotiable: a plate is never invented. Where the source does not
// support a character, that position stays UNKNOWN_CHAR and the decision
// degrades to PARTIALLY_READABLE / UNREADABLE / REVIEW_REQUIRED rather than
// being completed by inference. See plateConsensus.ts.
// ---------------------------------------------------------------------------

/** Placeholder for a character position the source evidence does not support. Never replaced by a guess. */
export const UNKNOWN_CHAR = "?";

/**
 * Model/algorithm versions stamped onto every recovery result, so a future
 * model upgrade can never silently change the meaning of historical evidence
 * (§37). Bump the relevant entry whenever its behaviour changes.
 */
export const PROCESSING_VERSIONS = {
  detector: "coco-ssd@2.2.3 (lite_mobilenet_v2)",
  tracker: "civiquex-iou-tracker@1",
  frameQuality: "civiquex-frame-quality@1",
  plateLocator: "civiquex-plate-heuristic@1",
  ocr: "tesseract.js@6 (eng, plate charset)",
  consensus: "civiquex-plate-consensus@1",
  pipeline: "civiquex-plate-recovery@1",
} as const;

export type ProcessingVersions = typeof PROCESSING_VERSIONS;

/** [x, y, w, h] as a fraction (0-1) of frame dimensions — resolution-independent. */
export type NormalizedBox = [number, number, number, number];

/**
 * Where a derived image came from. Every crop/enhanced image must be traceable
 * back to an exact original frame (§1, §36) — the original upload is immutable
 * and is never overwritten by any of this.
 */
export interface FrameProvenance {
  /** Evidence/content hash of the immutable source recording. */
  sourceMediaHash: string;
  /** Monotonic frame index within the analysed window. */
  frameIndex: number;
  /** Offset into the source recording, in seconds. Authoritative over frameIndex for variable-FPS sources. */
  sourceTimeSeconds: number;
  /** Wall-clock capture time for this frame, when the recording's start time is known. */
  capturedAt?: string;
}

/** Independent, individually explainable quality dimensions for one candidate frame (§7). */
export interface FrameQualityScores {
  sharpness: number; // 0-1, variance-of-Laplacian based
  motionBlur: number; // 0-1, 1 = no detectable directional blur
  exposure: number; // 0-1, 1 = well exposed (not crushed/blown)
  contrast: number; // 0-1
  glare: number; // 0-1, 1 = no blown-highlight glare
  /** Composite 0-100. Interpretable, not a model output. */
  overall: number;
}

/** A vehicle observed in one frame. */
export interface VehicleSighting {
  provenance: FrameProvenance;
  box: NormalizedBox;
  /** Detector confidence for this sighting, 0-1. */
  confidence: number;
  label: string; // "car" | "truck" | "motorcycle" | "bus" ...
}

/**
 * One vehicle followed across frames (§2). Plate recovery operates on a track,
 * never on unrelated frames — this is what prevents a nearby vehicle's plate
 * being attributed to the offender (§14, §15).
 */
export interface VehicleTrack {
  trackId: string;
  label: string;
  sightings: VehicleSighting[];
  /** True when the tracker had to bridge a gap (occlusion) and re-associate (§16). */
  hadOcclusionGap: boolean;
  /**
   * Set when re-association after a gap could not be confirmed with enough
   * certainty. Any plate recovered from such a track is capped at
   * REVIEW_REQUIRED — identity is not established (§13, §16).
   */
  identityUncertain: boolean;
}

/** A single OCR reading of one plate crop, from one specific frame. */
export interface PlateObservation {
  provenance: FrameProvenance;
  /** Raw OCR text, normalized to A-Z0-9 only. May contain UNKNOWN_CHAR. */
  text: string;
  /** Per-character confidence, 0-1, index-aligned with `text`. */
  charConfidences: number[];
  /** OCR engine's own confidence for the whole read, 0-1. */
  ocrConfidence: number;
  /** Quality of the frame this reading came from. */
  quality: FrameQualityScores;
  /** Plate region within the frame. */
  plateBox: NormalizedBox;
  /** Longest edge of the plate crop in source pixels — the hard floor for legibility (§19). */
  platePixelWidth: number;
}

/**
 * The only permitted outcomes (§24). There is deliberately no "best guess"
 * state — a vehicle is never forced into a readable result.
 */
export type PlateDecision =
  | "CONFIRMED"
  | "REVIEW_REQUIRED"
  | "PARTIALLY_READABLE"
  | "UNREADABLE"
  | "CONFLICTING";

/** Why a decision landed where it did — shown to the reviewer (§35) and auditable (§36). */
export interface PlateReasoning {
  code:
    | "AGREEING_FRAMES"
    | "SINGLE_FRAME_ONLY"
    | "CHARACTER_CONFLICT"
    | "CONFUSABLE_AMBIGUITY"
    | "RESOLUTION_INSUFFICIENT"
    | "NO_READABLE_FRAMES"
    | "IDENTITY_UNCERTAIN"
    | "LOW_FRAME_QUALITY";
  detail: string;
}

/** Independent evidence dimensions combined into an interpretable score (§22) — deliberately NOT "the model said 93%". */
export interface PlateEvidenceBreakdown {
  detection: number; // vehicle was reliably detected
  tracking: number; // track was continuous / identity held
  localization: number; // plate region located consistently
  imageQuality: number; // best supporting frames were legible
  ocrAgreement: number; // independent reads agreed character-by-character
  temporalConsistency: number; // agreement held across time, not one lucky frame
  identity: number; // the plate provably belongs to the tracked offending vehicle
}

/** The complete, auditable outcome for one tracked vehicle (§21). */
export interface PlateRecoveryResult {
  trackId: string;
  decision: PlateDecision;
  /** Consensus plate. Contains UNKNOWN_CHAR at unsupported positions. Null when nothing was readable. */
  plate: string | null;
  /** Per-position detail backing `plate` — never collapsed away, so a reviewer can see exactly where doubt lies. */
  characters: PlateCharacterConsensus[];
  reasoning: PlateReasoning[];
  breakdown: PlateEvidenceBreakdown;
  /** Interpretable 0-100. */
  evidenceQuality: number;
  /** Provenance of the single best supporting frame. */
  bestFrame: FrameProvenance | null;
  /** Provenance of every frame that contributed a reading. */
  supportingFrames: FrameProvenance[];
  versions: ProcessingVersions;
}

/** Consensus detail for one character position (§12). */
export interface PlateCharacterConsensus {
  position: number;
  /** Agreed character, or UNKNOWN_CHAR when the evidence does not support one. */
  character: string;
  /** Every distinct character observed at this position, with support counts. */
  candidates: { character: string; votes: number; weight: number }[];
  /** True when the disagreement is only between known-confusable glyphs (§13). */
  confusableOnly: boolean;
  /** 0-1 agreement strength across contributing frames. */
  agreement: number;
}
