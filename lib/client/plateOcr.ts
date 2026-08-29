"use client";

// ---------------------------------------------------------------------------
// Plate candidate discovery (§6) + conservative restoration (§9) + OCR (§11)
//
// Deliberately NOT "better OCR". This module's only job is to turn one video
// frame plus one tracked vehicle box into zero or more *honest* plate
// readings, each carrying per-character confidence and the provenance needed
// to audit it later. Deciding what those readings mean is the consensus and
// sufficiency engines' job (lib/vision/*), never this file's.
//
// Two hard rules are enforced here:
//   - Enhancement is non-generative (§9, §25). Grayscale, contrast
//     normalization and thresholding only. Nothing that could synthesize a
//     character that was not in the source pixels.
//   - A crop below the resolution floor is reported as-is and left for the
//     consensus engine to discard (§24) — it is never upscaled to "recover"
//     detail that the source never captured.
// ---------------------------------------------------------------------------

import { scoreFrameQuality } from "@/lib/vision/frameQuality";
import { plateBelongsToVehicle } from "@/lib/vision/vehicleTracker";
import type { FrameProvenance, NormalizedBox, PlateObservation } from "@/lib/vision/plateTypes";

/** Indian plates are roughly 2:1 to 5:1; anything outside this is not a plate. */
const MIN_PLATE_ASPECT = 1.8;
const MAX_PLATE_ASPECT = 6.0;
/** Tesseract's charset for plates — restricting the alphabet materially reduces garbage reads. */
const PLATE_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

type TesseractWorker = {
  setParameters(params: Record<string, unknown>): Promise<unknown>;
  recognize(image: HTMLCanvasElement, options?: unknown, output?: unknown): Promise<{ data: TesseractPage }>;
  terminate(): Promise<unknown>;
};

interface TesseractSymbol {
  text: string;
  confidence: number;
}
interface TesseractPage {
  text: string;
  confidence: number;
  blocks:
    | {
        paragraphs: { lines: { words: { symbols: TesseractSymbol[] }[] }[] }[];
      }[]
    | null;
}

let workerPromise: Promise<TesseractWorker> | null = null;

/**
 * Loads the OCR worker once, lazily. Tesseract ships several MB of WASM plus
 * language data, so this must never be pulled in on page load — same deferred
 * treatment the TensorFlow.js detector already gets.
 */
export async function getPlateOcrWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = (await createWorker("eng")) as unknown as TesseractWorker;
      await worker.setParameters({
        tessedit_char_whitelist: PLATE_CHARSET,
        // A plate is one line of text, not a page to be laid out.
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });
      return worker;
    })().catch((err) => {
      workerPromise = null; // allow a later retry rather than failing permanently
      throw err;
    });
  }
  return workerPromise;
}

export async function disposePlateOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  await worker?.terminate().catch(() => undefined);
}

function cropToCanvas(source: HTMLCanvasElement, box: NormalizedBox): HTMLCanvasElement | null {
  const sx = Math.max(0, Math.round(box[0] * source.width));
  const sy = Math.max(0, Math.round(box[1] * source.height));
  const sw = Math.min(source.width - sx, Math.round(box[2] * source.width));
  const sh = Math.min(source.height - sy, Math.round(box[3] * source.height));
  if (sw <= 0 || sh <= 0) return null;

  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/**
 * Conservative, non-generative restoration (§9). Grayscale + contrast
 * stretch only: it redistributes information that is already present, and
 * cannot invent a character. Explicitly no super-resolution, no inpainting,
 * no learned restoration — those could manufacture evidence.
 */
export function enhancePlateCrop(crop: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = crop.getContext("2d");
  if (!ctx) return crop;
  const image = ctx.getImageData(0, 0, crop.width, crop.height);
  const d = image.data;

  let min = 255;
  let max = 0;
  const luma = new Float32Array(crop.width * crop.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    luma[p] = y;
    if (y < min) min = y;
    if (y > max) max = y;
  }

  const range = Math.max(1, max - min);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const stretched = ((luma[p] - min) / range) * 255;
    d[i] = d[i + 1] = d[i + 2] = stretched;
  }
  ctx.putImageData(image, 0, 0);
  return crop;
}

/**
 * Locates probable plate regions inside a tracked vehicle's box (§6).
 *
 * This is an explicit heuristic, not a trained plate detector: plates sit low
 * and centred on a vehicle's rear, and show a dense band of vertical edges
 * (character strokes) against a flat background. It scans candidate bands in
 * the lower half of the vehicle and keeps those with plate-like aspect ratio
 * and the strongest edge density.
 *
 * Being a heuristic, it will sometimes miss or mislocate — which is precisely
 * why every downstream decision requires multi-frame agreement rather than
 * trusting any single localization.
 */
export function locatePlateCandidates(frame: HTMLCanvasElement, vehicleBox: NormalizedBox, maxCandidates = 2): NormalizedBox[] {
  const ctx = frame.getContext("2d");
  if (!ctx) return [];

  const vx = Math.max(0, Math.round(vehicleBox[0] * frame.width));
  const vy = Math.max(0, Math.round(vehicleBox[1] * frame.height));
  const vw = Math.min(frame.width - vx, Math.round(vehicleBox[2] * frame.width));
  const vh = Math.min(frame.height - vy, Math.round(vehicleBox[3] * frame.height));
  if (vw < 24 || vh < 24) return [];

  // Plates live in the lower portion of a vehicle's rear.
  const searchTop = vy + Math.round(vh * 0.45);
  const searchHeight = vy + vh - searchTop;
  if (searchHeight < 8) return [];

  const region = ctx.getImageData(vx, searchTop, vw, searchHeight);
  const d = region.data;
  const rowEdge = new Float32Array(searchHeight);

  for (let y = 0; y < searchHeight; y++) {
    let sum = 0;
    for (let x = 1; x < vw - 1; x++) {
      const i = (y * vw + x) * 4;
      const left = 0.299 * d[i - 4] + 0.587 * d[i - 3] + 0.114 * d[i - 2];
      const right = 0.299 * d[i + 4] + 0.587 * d[i + 5] + 0.114 * d[i + 6];
      sum += Math.abs(right - left);
    }
    rowEdge[y] = sum / Math.max(1, vw);
  }

  // Slide plate-height windows and rank by mean edge density.
  const candidates: { box: NormalizedBox; score: number }[] = [];
  for (let bandH = Math.max(6, Math.round(vh * 0.10)); bandH <= Math.round(vh * 0.30); bandH += Math.max(2, Math.round(vh * 0.05))) {
    const bandW = Math.round(bandH * 3.2); // typical plate aspect
    if (bandW > vw) continue;
    const aspect = bandW / bandH;
    if (aspect < MIN_PLATE_ASPECT || aspect > MAX_PLATE_ASPECT) continue;

    for (let y = 0; y + bandH <= searchHeight; y += Math.max(2, Math.round(bandH / 3))) {
      let energy = 0;
      for (let yy = y; yy < y + bandH; yy++) energy += rowEdge[yy];
      const meanEnergy = energy / bandH;
      // Plates are horizontally centred on the vehicle far more often than not.
      const xStart = vx + Math.round((vw - bandW) / 2);
      candidates.push({
        box: [xStart / frame.width, (searchTop + y) / frame.height, bandW / frame.width, bandH / frame.height],
        score: meanEnergy,
      });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates)
    .map((c) => c.box)
    .filter((box) => plateBelongsToVehicle(box, vehicleBox));
}

/** Flattens Tesseract's block hierarchy into per-character text + confidence (§14). */
function extractSymbols(page: TesseractPage): TesseractSymbol[] {
  const symbols: TesseractSymbol[] = [];
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const word of line.words ?? []) {
          for (const sym of word.symbols ?? []) symbols.push(sym);
        }
      }
    }
  }
  return symbols;
}

export interface ReadPlateInput {
  frame: HTMLCanvasElement;
  vehicleBox: NormalizedBox;
  provenance: FrameProvenance;
}

/**
 * Produces plate observations for one frame of one tracked vehicle. Returns an
 * empty array when no plausible plate region exists — an honest "nothing here"
 * rather than a low-confidence guess.
 */
export async function readPlateFromFrame(input: ReadPlateInput): Promise<PlateObservation[]> {
  const boxes = locatePlateCandidates(input.frame, input.vehicleBox);
  if (boxes.length === 0) return [];

  const worker = await getPlateOcrWorker();
  const observations: PlateObservation[] = [];

  for (const box of boxes) {
    const crop = cropToCanvas(input.frame, box);
    if (!crop) continue;

    const cropCtx = crop.getContext("2d");
    if (!cropCtx) continue;
    // Quality is measured on the ORIGINAL crop, before any enhancement, so the
    // score reflects the source evidence rather than our processing of it.
    const quality = scoreFrameQuality(cropCtx.getImageData(0, 0, crop.width, crop.height));

    const enhanced = enhancePlateCrop(crop);

    let page: TesseractPage;
    try {
      const result = await worker.recognize(enhanced, undefined, { blocks: true, text: true });
      page = result.data;
    } catch {
      continue; // a failed read contributes nothing; it never becomes a guess
    }

    const symbols = extractSymbols(page).filter((s) => /[A-Z0-9]/.test(s.text));
    const text = symbols.map((s) => s.text).join("");
    if (text.length === 0) continue;

    observations.push({
      provenance: input.provenance,
      text,
      charConfidences: symbols.map((s) => Math.max(0, Math.min(1, s.confidence / 100))),
      ocrConfidence: Math.max(0, Math.min(1, (page.confidence ?? 0) / 100)),
      quality,
      plateBox: box,
      platePixelWidth: crop.width,
    });
  }

  return observations;
}
