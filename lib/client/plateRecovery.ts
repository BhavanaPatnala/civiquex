"use client";

// ---------------------------------------------------------------------------
// Temporal Evidence Recovery orchestrator
//
// Implements the coarse-to-fine strategy (§26, §27, §32): every sampled frame
// gets cheap vehicle detection, but only the highest-information frames of the
// offending vehicle's track get expensive plate OCR. This is what keeps cost
// bounded — spending compute where evidence is likely to exist rather than
// running the full stack over every frame.
//
// The original recording is never modified (§1). Everything produced here is
// a derived artifact carrying provenance back to an exact source timestamp.
// ---------------------------------------------------------------------------

import { readPlateFromFrame } from "@/lib/client/plateOcr";
import { selectBestFrames } from "@/lib/vision/frameQuality";
import { scoreFrameQuality } from "@/lib/vision/frameQuality";
import { assessPlateEvidence } from "@/lib/vision/plateEvidence";
import { plateBelongsToVehicle, selectPrimaryTrack, trackVehicles, VEHICLE_LABELS } from "@/lib/vision/vehicleTracker";
import type { FrameProvenance, PlateObservation, PlateRecoveryResult, VehicleSighting } from "@/lib/vision/plateTypes";

/** Frames sampled per second during the coarse scan. */
const BASE_SAMPLE_FPS = 6;
/** Raised automatically for fast-moving vehicles (§12). */
const FAST_MODE_SAMPLE_FPS = 12;
/** Per-frame displacement (fraction of frame width) above which fast mode engages. */
const FAST_MODE_DISPLACEMENT = 0.06;
/** Hard ceiling on frames decoded, so a long clip cannot blow up memory (§29). */
const MAX_SAMPLED_FRAMES = 90;
/** Only this many of the best frames receive OCR — the expensive stage. */
const MAX_OCR_FRAMES = 6;

/** Detects objects in a single frame. Injected so the orchestrator stays testable and model-agnostic. */
export type FrameDetector = (canvas: HTMLCanvasElement) => Promise<{ label: string; confidence: number; bbox: [number, number, number, number] }[]>;

export interface PlateRecoveryOptions {
  detect: FrameDetector;
  sourceMediaHash: string;
  onProgress?: (stage: string, fraction: number) => void;
  signal?: AbortSignal;
}

interface SampledFrame {
  canvas: HTMLCanvasElement;
  provenance: FrameProvenance;
}

/**
 * Decodes frames from a video blob one at a time by seeking — never loading
 * every frame into memory at once (§2, §29). Memory stays bounded regardless
 * of clip length.
 */
async function sampleFrames(blob: Blob, fps: number, hash: string, signal?: AbortSignal): Promise<SampledFrame[]> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("decode-failed"));
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0 || !video.videoWidth) return [];

    const step = 1 / fps;
    const count = Math.min(MAX_SAMPLED_FRAMES, Math.max(1, Math.floor(duration / step)));
    const frames: SampledFrame[] = [];

    for (let i = 0; i < count; i++) {
      if (signal?.aborted) break;
      const t = Math.min(duration - 0.001, i * step);

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
        video.currentTime = t;
      });

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      frames.push({
        canvas,
        // sourceTimeSeconds is authoritative over frameIndex: it stays correct
        // for variable-frame-rate recordings, where frame number alone lies.
        provenance: { sourceMediaHash: hash, frameIndex: i, sourceTimeSeconds: t },
      });
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Mean per-frame displacement of a track's centre, as a fraction of frame width (§11, §12). */
function meanDisplacement(sightings: VehicleSighting[]): number {
  if (sightings.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < sightings.length; i++) {
    const [ax, ay, aw, ah] = sightings[i - 1].box;
    const [bx, by, bw, bh] = sightings[i].box;
    const dx = bx + bw / 2 - (ax + aw / 2);
    const dy = by + bh / 2 - (ay + ah / 2);
    total += Math.hypot(dx, dy);
  }
  return total / (sightings.length - 1);
}

export interface PlateRecoveryOutcome {
  result: PlateRecoveryResult | null;
  /** True when the fast-vehicle path was engaged. */
  fastMode: boolean;
  framesSampled: number;
  framesOcrd: number;
  /** Set when recovery could not run at all (rather than running and abstaining). */
  unavailableReason?: "decode-failed" | "no-vehicle-tracked" | "aborted";
}

/**
 * Runs the full recovery pipeline over a captured video.
 *
 * Returns `result: null` with an `unavailableReason` only when the pipeline
 * could not execute. When it executes but the evidence is weak, it returns a
 * real result whose decision is UNREADABLE / REVIEW_REQUIRED — abstention is a
 * successful outcome here, not a failure (§23).
 */
export async function recoverPlateFromVideo(blob: Blob, options: PlateRecoveryOptions): Promise<PlateRecoveryOutcome> {
  const { detect, sourceMediaHash, onProgress, signal } = options;

  onProgress?.("Scanning the recording for vehicles…", 0.05);
  let frames = await sampleFrames(blob, BASE_SAMPLE_FPS, sourceMediaHash, signal).catch(() => []);
  if (signal?.aborted) return { result: null, fastMode: false, framesSampled: 0, framesOcrd: 0, unavailableReason: "aborted" };
  if (frames.length === 0) return { result: null, fastMode: false, framesSampled: 0, framesOcrd: 0, unavailableReason: "decode-failed" };

  // ---- Coarse pass: cheap detection on every sampled frame.
  const detectFrames = async (list: SampledFrame[]) => {
    const perFrame: { sightings: VehicleSighting[] }[] = [];
    for (let i = 0; i < list.length; i++) {
      if (signal?.aborted) break;
      const detections = await detect(list[i].canvas).catch(() => []);
      perFrame.push({
        sightings: detections
          .filter((d) => VEHICLE_LABELS.has(d.label))
          .map((d) => ({ provenance: list[i].provenance, box: d.bbox, confidence: d.confidence, label: d.label })),
      });
      onProgress?.("Tracking vehicles across the recording…", 0.1 + (i / list.length) * 0.5);
    }
    return perFrame;
  };

  let perFrame = await detectFrames(frames);
  let tracks = trackVehicles({ frames: perFrame });
  let primary = selectPrimaryTrack(tracks);

  // ---- Fast-vehicle mode (§12): a vehicle crossing quickly is under-sampled
  // at the base rate, so re-scan that clip more densely before giving up on it.
  let fastMode = false;
  if (primary && meanDisplacement(primary.sightings) > FAST_MODE_DISPLACEMENT) {
    fastMode = true;
    onProgress?.("Fast-moving vehicle — increasing temporal resolution…", 0.6);
    const denser = await sampleFrames(blob, FAST_MODE_SAMPLE_FPS, sourceMediaHash, signal).catch(() => []);
    if (denser.length > frames.length) {
      frames = denser;
      perFrame = await detectFrames(frames);
      tracks = trackVehicles({ frames: perFrame });
      primary = selectPrimaryTrack(tracks);
    }
  }

  if (!primary || primary.sightings.length === 0) {
    return { result: null, fastMode, framesSampled: frames.length, framesOcrd: 0, unavailableReason: "no-vehicle-tracked" };
  }

  // ---- Best-evidence hunting (§2, §3): rank this vehicle's frames by measured
  // quality, not by whether they were the "violation" frame.
  onProgress?.("Selecting the clearest frames of this vehicle…", 0.7);
  const byFrameIndex = new Map(frames.map((f) => [f.provenance.frameIndex, f]));
  const scored = primary.sightings
    .map((s) => {
      const frame = byFrameIndex.get(s.provenance.frameIndex);
      if (!frame) return null;
      const ctx = frame.canvas.getContext("2d");
      if (!ctx) return null;
      return { sighting: s, frame, quality: scoreFrameQuality(ctx.getImageData(0, 0, frame.canvas.width, frame.canvas.height)) };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const best = selectBestFrames(scored, MAX_OCR_FRAMES);

  // ---- Deep pass: OCR only the selected frames (§26).
  const observations: PlateObservation[] = [];
  let rejectedForGeometry = 0;

  for (let i = 0; i < best.length; i++) {
    if (signal?.aborted) break;
    onProgress?.("Reading the number plate across frames…", 0.75 + (i / best.length) * 0.2);
    const { frame, sighting } = best[i];
    const found = await readPlateFromFrame({
      frame: frame.canvas,
      vehicleBox: sighting.box,
      provenance: frame.provenance,
    }).catch(() => []);

    for (const obs of found) {
      // Identity lock (§6, §14): a plate region must sit on THIS vehicle.
      if (!plateBelongsToVehicle(obs.plateBox, sighting.box)) {
        rejectedForGeometry++;
        continue;
      }
      observations.push(obs);
    }
  }

  onProgress?.("Cross-checking the evidence…", 0.97);
  const result = assessPlateEvidence({ track: primary, observations, rejectedForGeometry });

  return { result, fastMode, framesSampled: frames.length, framesOcrd: best.length };
}
