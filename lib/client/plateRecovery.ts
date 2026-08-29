"use client";

// ---------------------------------------------------------------------------
// Temporal Evidence Recovery orchestrator
//
// Coarse-to-fine by design (§26, §27, §32): a cheap detection pass over
// downscaled frames finds and tracks vehicles, then a second pass re-decodes
// ONLY the handful of best frames at full resolution for expensive plate OCR.
//
// Memory safety is the hard constraint here (§29), and it is enforced
// structurally rather than by comment: frames are streamed through a callback
// and released immediately, so exactly one decoded frame is alive at a time.
// An earlier revision of this file accumulated every sampled frame in an
// array — at 1080p that is hundreds of megabytes and crashed the tab outright.
// Nothing in this module may retain a full-resolution canvas beyond the
// callback that receives it.
//
// The original recording is never modified (§1). Everything produced here is a
// derived artifact carrying provenance back to an exact source timestamp.
// ---------------------------------------------------------------------------

import { readPlateFromFrame, warmUpPlateOcr } from "@/lib/client/plateOcr";
import { assessPlateEvidence } from "@/lib/vision/plateEvidence";
import { plateBelongsToVehicle, selectPrimaryTrack, trackVehicles, VEHICLE_LABELS } from "@/lib/vision/vehicleTracker";
import type { FrameProvenance, PlateObservation, PlateRecoveryResult, VehicleSighting } from "@/lib/vision/plateTypes";

/** Frames sampled per second during the coarse scan. */
const BASE_SAMPLE_FPS = 4;
/** Raised for fast-moving vehicles (§12), but never re-decodes the whole clip twice. */
const FAST_MODE_SAMPLE_FPS = 8;
/** Per-frame displacement (fraction of frame width) above which fast mode engages. */
const FAST_MODE_DISPLACEMENT = 0.06;
/** Hard ceiling on frames decoded in the coarse pass, independent of clip length. */
const MAX_COARSE_FRAMES = 30;
/** Only this many of the best frames are re-decoded at full resolution for OCR. */
const MAX_OCR_FRAMES = 4;
/**
 * Detection input is downscaled to this width. COCO-SSD's lite_mobilenet_v2
 * resizes internally anyway, so full resolution buys nothing for detection
 * while costing memory and inference time linearly.
 */
const DETECT_MAX_WIDTH = 640;
/** Whole-pipeline budget. Past this, we stop and report on what we have (§27). */
const TIME_BUDGET_MS = 45_000;

/** Detects objects in a single frame. Injected so the orchestrator stays testable and model-agnostic. */
export type FrameDetector = (canvas: HTMLCanvasElement) => Promise<{ label: string; confidence: number; bbox: [number, number, number, number] }[]>;

export interface PlateRecoveryOptions {
  detect: FrameDetector;
  sourceMediaHash: string;
  onProgress?: (stage: string, fraction: number) => void;
  signal?: AbortSignal;
}

/** Opens a video element for frame-accurate seeking, and guarantees teardown. */
async function withVideo<T>(blob: Blob, fn: (video: HTMLVideoElement) => Promise<T>): Promise<T> {
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
    return await fn(video);
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = t;
  });
}

/** Frees a canvas's backing store rather than waiting on GC — matters when iterating many frames. */
function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Streams frames to `onFrame` one at a time, releasing each before decoding
 * the next. The canvas passed to the callback is reused and torn down — it
 * must not be retained.
 */
async function streamFrames(
  video: HTMLVideoElement,
  times: number[],
  maxWidth: number | null,
  onFrame: (canvas: HTMLCanvasElement, index: number, t: number) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  for (let i = 0; i < times.length; i++) {
    if (signal?.aborted) return;
    await seekTo(video, times[i]);

    const scale = maxWidth && video.videoWidth > maxWidth ? maxWidth / video.videoWidth : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      releaseCanvas(canvas);
      continue;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      await onFrame(canvas, i, times[i]);
    } finally {
      releaseCanvas(canvas);
    }
  }
}

function sampleTimes(from: number, to: number, fps: number, cap: number): number[] {
  const span = Math.max(0, to - from);
  const step = 1 / fps;
  const count = Math.min(cap, Math.max(1, Math.floor(span / step)));
  return Array.from({ length: count }, (_, i) => Math.min(to - 0.001, from + i * step));
}

/** Mean per-frame displacement of a track's centre, as a fraction of frame width (§11, §12). */
function meanDisplacement(sightings: VehicleSighting[]): number {
  if (sightings.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < sightings.length; i++) {
    const [ax, ay, aw, ah] = sightings[i - 1].box;
    const [bx, by, bw, bh] = sightings[i].box;
    total += Math.hypot(bx + bw / 2 - (ax + aw / 2), by + bh / 2 - (ay + ah / 2));
  }
  return total / (sightings.length - 1);
}

export interface PlateRecoveryOutcome {
  result: PlateRecoveryResult | null;
  fastMode: boolean;
  framesSampled: number;
  framesOcrd: number;
  /** Set when recovery could not run at all (rather than running and abstaining). */
  unavailableReason?: "decode-failed" | "no-vehicle-tracked" | "aborted" | "timed-out";
}

/**
 * Runs the full recovery pipeline over a captured video.
 *
 * Returns `result: null` with an `unavailableReason` only when the pipeline
 * could not execute. When it runs but the evidence is weak, it returns a real
 * result whose decision is UNREADABLE / REVIEW_REQUIRED — abstention is a
 * successful outcome here, not a failure (§23).
 */
export async function recoverPlateFromVideo(blob: Blob, options: PlateRecoveryOptions): Promise<PlateRecoveryOutcome> {
  const { detect, sourceMediaHash, onProgress, signal } = options;
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;

  try {
    return await withVideo(blob, async (video) => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (duration <= 0 || !video.videoWidth) {
        return { result: null, fastMode: false, framesSampled: 0, framesOcrd: 0, unavailableReason: "decode-failed" as const };
      }

      // ---- Pass 1 (coarse): detect on downscaled frames, retaining only
      // detection results. No full-resolution canvas survives this loop.
      const runCoarsePass = async (fps: number, from = 0, to = duration) => {
        const times = sampleTimes(from, to, fps, MAX_COARSE_FRAMES);
        const perFrame: { sightings: VehicleSighting[] }[] = [];
        const frameTimes: number[] = [];

        await streamFrames(
          video,
          times,
          DETECT_MAX_WIDTH,
          async (canvas, i, t) => {
            if (outOfTime()) return;
            const provenance: FrameProvenance = { sourceMediaHash, frameIndex: i, sourceTimeSeconds: t };
            const detections = await detect(canvas).catch(() => []);
            perFrame.push({
              sightings: detections
                .filter((d) => VEHICLE_LABELS.has(d.label))
                .map((d) => ({ provenance, box: d.bbox, confidence: d.confidence, label: d.label })),
            });
            frameTimes.push(t);
            onProgress?.("Tracking vehicles across the recording…", 0.05 + (i / times.length) * 0.55);
          },
          signal
        );

        return { perFrame, frameTimes };
      };

      // Start the OCR model downloading now, in parallel with the coarse pass,
      // rather than paying for it serially at the first plate read.
      void warmUpPlateOcr();

      let { perFrame, frameTimes } = await runCoarsePass(BASE_SAMPLE_FPS);
      if (signal?.aborted) return { result: null, fastMode: false, framesSampled: frameTimes.length, framesOcrd: 0, unavailableReason: "aborted" as const };

      let tracks = trackVehicles({ frames: perFrame });
      let primary = selectPrimaryTrack(tracks);
      let fastMode = false;

      // ---- Fast-vehicle mode (§12). Re-scans only the window where this
      // vehicle was actually visible, not the whole clip: a vehicle crossing
      // quickly occupies a short span, so a full second pass would roughly
      // double runtime to add detail almost entirely outside the window that
      // matters.
      if (primary && meanDisplacement(primary.sightings) > FAST_MODE_DISPLACEMENT && !outOfTime()) {
        const seen = primary.sightings.map((s) => s.provenance.sourceTimeSeconds);
        const from = Math.max(0, Math.min(...seen) - 0.5);
        const to = Math.min(duration, Math.max(...seen) + 0.5);
        if (to - from > 0.2 && to - from < duration * 0.9) {
          fastMode = true;
          onProgress?.("Fast-moving vehicle — increasing temporal resolution…", 0.6);
          const denser = await runCoarsePass(FAST_MODE_SAMPLE_FPS, from, to);
          if (denser.frameTimes.length > 2) {
            perFrame = denser.perFrame;
            frameTimes = denser.frameTimes;
            tracks = trackVehicles({ frames: perFrame });
            primary = selectPrimaryTrack(tracks) ?? primary;
          }
        }
      }

      if (!primary || primary.sightings.length === 0) {
        return { result: null, fastMode, framesSampled: frameTimes.length, framesOcrd: 0, unavailableReason: "no-vehicle-tracked" as const };
      }

      // ---- Best-evidence hunting (§2, §3). Without retaining pixels, rank
      // candidate frames by a cheap proxy for how many real plate pixels they
      // are likely to contain: a nearer, larger, more confidently detected
      // vehicle. True image quality is measured in pass 2 on the actual crop.
      onProgress?.("Selecting the clearest frames of this vehicle…", 0.68);
      const ranked = [...primary.sightings]
        .map((s) => ({ sighting: s, score: s.box[2] * s.box[3] * s.confidence }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_OCR_FRAMES);

      // ---- Pass 2 (deep): re-decode ONLY these frames, at full resolution,
      // one at a time. This is the expensive stage and it runs on ≤4 frames.
      const observations: PlateObservation[] = [];
      let rejectedForGeometry = 0;
      let ocrd = 0;

      const byTime = new Map(ranked.map((r) => [r.sighting.provenance.sourceTimeSeconds, r.sighting]));
      const deepTimes = [...byTime.keys()].sort((a, b) => a - b);

      await streamFrames(
        video,
        deepTimes,
        null, // full resolution — plate legibility depends on real pixels
        async (canvas, i, t) => {
          if (outOfTime() || signal?.aborted) return;
          const sighting = byTime.get(t);
          if (!sighting) return;
          onProgress?.("Reading the number plate across frames…", 0.72 + (i / deepTimes.length) * 0.25);
          ocrd++;

          const found = await readPlateFromFrame({
            frame: canvas,
            vehicleBox: sighting.box,
            provenance: sighting.provenance,
          }).catch(() => []);

          for (const obs of found) {
            // Identity lock (§6, §14): a plate region must sit on THIS vehicle.
            if (!plateBelongsToVehicle(obs.plateBox, sighting.box)) {
              rejectedForGeometry++;
              continue;
            }
            observations.push(obs);
          }
        },
        signal
      );

      onProgress?.("Cross-checking the evidence…", 0.97);
      const result = assessPlateEvidence({ track: primary, observations, rejectedForGeometry });

      return { result, fastMode, framesSampled: frameTimes.length, framesOcrd: ocrd };
    });
  } catch {
    return { result: null, fastMode: false, framesSampled: 0, framesOcrd: 0, unavailableReason: "decode-failed" };
  }
}
