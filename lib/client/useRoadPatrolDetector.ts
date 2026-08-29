"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectRoadAnomaly, ROAD_ANOMALY_MODEL_ID, type AnomalyResult } from "@/lib/client/roadAnomaly";

export interface DetectedObject {
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x,y,w,h] as a fraction of the frame
}

export interface PatrolFrameResult {
  at: number;
  objectDetections: DetectedObject[];
  anomaly: AnomalyResult;
  inferenceMs: number;
}

export type ModelStatus = "idle" | "loading" | "ready" | "unavailable";

const SCAN_INTERVAL_MS = 1500;
const COCO_SSD_MODEL_ID = "coco-ssd@2.2.3 (mobilenet_v2)";

interface CocoSsdPrediction {
  bbox: [number, number, number, number];
  class: string;
  score: number;
}
interface CocoSsdModel {
  detect(input: HTMLCanvasElement): Promise<CocoSsdPrediction[]>;
}

/**
 * Loads a real pretrained TensorFlow.js object-detection model (COCO-SSD)
 * once, then repeatedly runs it — plus the real Sobel road-anomaly scan —
 * on the live video frame. Every number here comes from an actual model
 * inference or an actual pixel computation; nothing is simulated.
 */
export function useRoadPatrolDetector(videoRef: React.RefObject<HTMLVideoElement>, options?: { autoLoad?: boolean }) {
  const autoLoad = options?.autoLoad ?? true;
  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [modelError, setModelError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState<PatrolFrameResult | null>(null);
  const [framesAnalyzed, setFramesAnalyzed] = useState(0);
  const [avgInferenceMs, setAvgInferenceMs] = useState(0);

  const modelRef = useRef<CocoSsdModel | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalInferenceMsRef = useRef(0);
  const framesAnalyzedRef = useRef(0);
  const loadStartedRef = useRef(false);

  // Loading TensorFlow.js + the COCO-SSD model is genuinely CPU-heavy (WebGL
  // shader compilation, multi-MB download) — kicking it off the instant this
  // hook mounts competes with the UI for the main thread right when a user
  // is clicking through the earliest, lightest steps of a flow. loadModel()
  // lets a caller defer that work until it's actually needed (see
  // app/(dashboard)/report/page.tsx, which starts it once the reporter has
  // moved past picking a category, not on page load).
  const loadModel = useCallback(() => {
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    setModelStatus("loading");
    (async () => {
      try {
        const tf = await import("@tensorflow/tfjs");
        await tf.ready();
        const cocoSsd = await import("@tensorflow-models/coco-ssd");
        const model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
        modelRef.current = model as unknown as CocoSsdModel;
        setModelStatus("ready");
      } catch (err) {
        setModelError(err instanceof Error ? err.message : "Failed to load the detection model");
        setModelStatus("unavailable");
      }
    })();
  }, []);

  useEffect(() => {
    if (autoLoad) loadModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  const analyzeCanvas = useCallback(
    async (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): Promise<PatrolFrameResult | null> => {
      const model = modelRef.current;
      if (!model) return null;

      // Real inference on arbitrary real-world input (unusual dimensions, a
      // lost WebGL context, a transient OOM under memory pressure) can throw
      // from inside TensorFlow.js/COCO-SSD itself — unlike the decode step
      // in analyzeImageBlob, this had no boundary, so a single bad frame
      // could crash the entire submission instead of honestly reporting "no
      // detection result" the same way every other failure mode here does.
      try {
        const start = performance.now();
        const predictions = await model.detect(canvas);
        const inferenceMs = performance.now() - start;

        const objectDetections: DetectedObject[] = predictions.map(
          (p): DetectedObject => ({
            label: p.class,
            confidence: p.score,
            bbox: [p.bbox[0] / canvas.width, p.bbox[1] / canvas.height, p.bbox[2] / canvas.width, p.bbox[3] / canvas.height],
          })
        );

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const anomaly = detectRoadAnomaly(imageData);

        const result: PatrolFrameResult = { at: Date.now(), objectDetections, anomaly, inferenceMs };
        totalInferenceMsRef.current += inferenceMs;
        framesAnalyzedRef.current += 1;
        setLastResult(result);
        setFramesAnalyzed(framesAnalyzedRef.current);
        setAvgInferenceMs(totalInferenceMsRef.current / framesAnalyzedRef.current);
        return result;
      } catch (err) {
        console.error("[patrol] frame analysis failed", err);
        return null;
      }
    },
    []
  );

  const runOnce = useCallback(async (): Promise<PatrolFrameResult | null> => {
    const video = videoRef.current;
    const model = modelRef.current;
    if (!video || !model || video.readyState < 2) return null;

    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return analyzeCanvas(canvas, ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef]);

  const start = useCallback(() => {
    if (timerRef.current) return;
    setScanning(true);
    void runOnce();
    timerRef.current = setInterval(() => void runOnce(), SCAN_INTERVAL_MS);
  }, [runOnce]);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  /**
   * Runs the loaded detector directly against a canvas and returns normalized
   * detections. Used by the temporal plate-recovery pipeline, which walks
   * many decoded video frames and must not pay a canvas→blob→bitmap round
   * trip per frame. Waits for the model rather than silently returning empty.
   */
  const detectInCanvas = useCallback(
    async (canvas: HTMLCanvasElement): Promise<DetectedObject[]> => {
      loadModel();
      for (let attempt = 0; attempt < 100 && !modelRef.current; attempt++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const model = modelRef.current;
      if (!model) return [];
      try {
        const predictions = await model.detect(canvas);
        return predictions.map((p) => ({
          label: p.class,
          confidence: p.score,
          bbox: [p.bbox[0] / canvas.width, p.bbox[1] / canvas.height, p.bbox[2] / canvas.width, p.bbox[3] / canvas.height] as [
            number,
            number,
            number,
            number,
          ],
        }));
      } catch (err) {
        console.error("[patrol] canvas detection failed", err);
        return [];
      }
    },
    [loadModel]
  );

  /** Captures the current video frame as a JPEG blob, for uploading a flagged candidate. */
  const captureFrameBlob = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85));
  }, [videoRef]);

  /**
   * Runs the same real detection pipeline (COCO-SSD + the Sobel anomaly
   * scan) against a single uploaded image instead of a live video frame —
   * the no-camera / no-permission fallback path. Waits for the model to
   * finish loading if it's still in flight, rather than silently no-op'ing,
   * and never throws — every failure mode comes back as a typed reason so
   * the UI can show an accurate message instead of hanging silently.
   */
  const analyzeImageBlob = useCallback(
    async (
      file: Blob
    ): Promise<
      { ok: true; result: PatrolFrameResult } | { ok: false; reason: "model-not-ready" | "decode-failed" | "canvas-unavailable" | "detection-failed" }
    > => {
      loadModel(); // no-op if already loading/loaded — safety net for a caller that skipped the deferred-load trigger
      for (let attempt = 0; attempt < 100 && !modelRef.current; attempt++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!modelRef.current) return { ok: false, reason: "model-not-ready" };

      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        return { ok: false, reason: "decode-failed" };
      }

      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap.close();
        return { ok: false, reason: "canvas-unavailable" };
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      const result = await analyzeCanvas(canvas, ctx);
      return result ? { ok: true, result } : { ok: false, reason: "detection-failed" };
    },
    [analyzeCanvas, loadModel]
  );

  return {
    modelStatus,
    modelError,
    scanning,
    loadModel,
    start,
    stop,
    runOnce,
    analyzeImageBlob,
    detectInCanvas,
    lastResult,
    framesAnalyzed,
    avgInferenceMs,
    captureFrameBlob,
    modelInfo: { objectModel: COCO_SSD_MODEL_ID, anomalyModel: ROAD_ANOMALY_MODEL_ID },
  };
}
