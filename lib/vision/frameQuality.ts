// ---------------------------------------------------------------------------
// Frame Quality Scoring (§7) + Motion-Blur Analysis (§8)
//
// Real pixel measurements — no model, no learned weights, nothing simulated —
// so a reviewer can be told exactly why one frame was chosen over another.
// Same approach as lib/client/roadAnomaly.ts: operate directly on ImageData.
//
// The purpose is frame *selection*, not enhancement. When a frame is blurred,
// the correct response is to look at neighbouring frames (§8), never to
// sharpen aggressively until characters "appear" — that manufactures evidence.
// ---------------------------------------------------------------------------

import type { FrameQualityScores } from "@/lib/vision/plateTypes";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Rec. 601 luma, matching the road-anomaly scanner's convention. */
function toLuma(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    luma[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return luma;
}

/**
 * Variance of the Laplacian — the standard, well-understood sharpness proxy.
 * A sharp image has many strong second-derivative responses; a blurred one
 * has few. Normalized against a reference variance that corresponds to a
 * comfortably legible plate crop.
 */
export function sharpnessScore(luma: Float32Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - width] - luma[i + width];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  const REFERENCE_VARIANCE = 500; // empirically ~ a legible, in-focus crop
  return clamp01(variance / REFERENCE_VARIANCE);
}

/**
 * Motion blur smears detail along the direction of travel, leaving gradients
 * strong across that axis and weak along it. Comparing horizontal and
 * vertical gradient energy therefore detects *directional* blur specifically,
 * which is what a fast-moving vehicle produces — as opposed to uniform
 * softness, which sharpnessScore already covers.
 *
 * Returns 1 for "no directional blur detected", approaching 0 as the smear
 * becomes severe.
 */
export function motionBlurScore(luma: Float32Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let gx = 0;
  let gy = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      gx += Math.abs(luma[i + 1] - luma[i - 1]);
      gy += Math.abs(luma[i + width] - luma[i - width]);
    }
  }
  const total = gx + gy;
  if (total === 0) return 0; // a perfectly flat frame carries no legible detail at all
  // Anisotropy: 0 when both axes carry equal detail, → 1 when one axis is wiped out.
  const anisotropy = Math.abs(gx - gy) / total;
  return clamp01(1 - anisotropy * 1.6);
}

/** Penalizes crushed shadows and blown highlights — both destroy plate characters irrecoverably. */
export function exposureScore(luma: Float32Array): number {
  if (luma.length === 0) return 0;
  let dark = 0;
  let bright = 0;
  let sum = 0;
  for (let i = 0; i < luma.length; i++) {
    const v = luma[i];
    sum += v;
    if (v < 12) dark++;
    else if (v > 243) bright++;
  }
  const clippedRatio = (dark + bright) / luma.length;
  const mean = sum / luma.length;
  // Ideal mid-tone around 128; drifting far from it costs, clipping costs more.
  const midtone = 1 - Math.abs(mean - 128) / 128;
  return clamp01(midtone * (1 - clippedRatio * 1.5));
}

/** Standard deviation of luminance, normalized — low contrast means characters do not separate from the plate. */
export function contrastScore(luma: Float32Array): number {
  if (luma.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < luma.length; i++) sum += luma[i];
  const mean = sum / luma.length;
  let variance = 0;
  for (let i = 0; i < luma.length; i++) {
    const d = luma[i] - mean;
    variance += d * d;
  }
  const std = Math.sqrt(variance / luma.length);
  const REFERENCE_STD = 60;
  return clamp01(std / REFERENCE_STD);
}

/**
 * Headlight/retroreflective glare shows up as a cluster of saturated pixels
 * (§20). Returns 1 for "no glare", falling as saturated area grows — a
 * heavily glared frame should lose to a neighbouring frame without glare.
 */
export function glareScore(luma: Float32Array): number {
  if (luma.length === 0) return 0;
  let saturated = 0;
  for (let i = 0; i < luma.length; i++) if (luma[i] > 250) saturated++;
  const ratio = saturated / luma.length;
  return clamp01(1 - ratio * 8);
}

/** Weights reflect what actually destroys plate legibility, worst offenders first. */
const QUALITY_WEIGHTS = { sharpness: 0.3, motionBlur: 0.25, exposure: 0.18, contrast: 0.17, glare: 0.1 } as const;

/** Scores one candidate frame (or plate crop) across all independent quality dimensions. */
export function scoreFrameQuality(image: ImageData): FrameQualityScores {
  const { width, height, data } = image;
  const luma = toLuma(data, width, height);

  const sharpness = sharpnessScore(luma, width, height);
  const motionBlur = motionBlurScore(luma, width, height);
  const exposure = exposureScore(luma);
  const contrast = contrastScore(luma);
  const glare = glareScore(luma);

  const overall =
    (sharpness * QUALITY_WEIGHTS.sharpness +
      motionBlur * QUALITY_WEIGHTS.motionBlur +
      exposure * QUALITY_WEIGHTS.exposure +
      contrast * QUALITY_WEIGHTS.contrast +
      glare * QUALITY_WEIGHTS.glare) *
    100;

  return { sharpness, motionBlur, exposure, contrast, glare, overall: Math.round(overall * 10) / 10 };
}

/**
 * Picks the strongest frames from a candidate window (§7) — the best plate
 * evidence is frequently NOT the frame where the violation was classified,
 * which is the entire reason the temporal search exists.
 */
export function selectBestFrames<T extends { quality: FrameQualityScores }>(candidates: T[], limit: number): T[] {
  return [...candidates].sort((a, b) => b.quality.overall - a.quality.overall).slice(0, limit);
}
