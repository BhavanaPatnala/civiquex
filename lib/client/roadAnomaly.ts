// ---------------------------------------------------------------------------
// Road-surface anomaly heuristic — genuine image-processing on real pixels,
// not a trained classifier. There is no open, verified-free pothole-specific
// neural network wired into this build, so pothole *candidates* are flagged
// with real signal processing: a Sobel edge-magnitude scan of the lower
// (road) portion of the frame, grid-binned, flagged where local edge energy
// is a statistical outlier against its surroundings — the way an untextured
// road surface reads as "smooth" and a crack/pothole reads as a sharp local
// discontinuity. This is deliberately transparent about what it is: a
// heuristic anomaly flag for human review, not a diagnosis. It is combined
// with real COCO-SSD neural-network detections (see useRoadPatrolDetector)
// for the "AI Analysis Proof" panel — one real trained model, one real
// classical CV algorithm, both operating on the actual captured pixels.
// ---------------------------------------------------------------------------

export interface AnomalyResult {
  score: number; // 0-1, statistical outlier strength of the strongest cell
  bbox: [number, number, number, number] | null; // [x,y,w,h] as a fraction of the full frame
  gridRows: number;
  gridCols: number;
  cellScores: number[]; // row-major, for the debug overlay
  meanEdge: number;
  stdEdge: number;
}

const GRID_COLS = 8;
const GRID_ROWS = 5;
const ROAD_REGION_START_Y = 0.4; // ignore the top ~40% (sky/horizon/buildings)

/** Sobel gradient magnitude for one pixel, from a grayscale buffer. */
function sobelAt(gray: Float32Array, w: number, x: number, y: number): number {
  const idx = (xx: number, yy: number) => yy * w + xx;
  const gx =
    -gray[idx(x - 1, y - 1)] + gray[idx(x + 1, y - 1)] +
    -2 * gray[idx(x - 1, y)] + 2 * gray[idx(x + 1, y)] +
    -gray[idx(x - 1, y + 1)] + gray[idx(x + 1, y + 1)];
  const gy =
    -gray[idx(x - 1, y - 1)] - 2 * gray[idx(x, y - 1)] - gray[idx(x + 1, y - 1)] +
    gray[idx(x - 1, y + 1)] + 2 * gray[idx(x, y + 1)] + gray[idx(x + 1, y + 1)];
  return Math.sqrt(gx * gx + gy * gy);
}

/**
 * Runs a real Sobel edge-magnitude scan over ImageData and grid-bins the
 * result to find the most statistically anomalous patch of the road region.
 */
export function detectRoadAnomaly(imageData: ImageData): AnomalyResult {
  const { data, width: w, height: h } = imageData;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const regionStartRow = Math.floor(h * ROAD_REGION_START_Y);
  const cellW = w / GRID_COLS;
  const cellH = (h - regionStartRow) / GRID_ROWS;

  const cellSums = new Float32Array(GRID_COLS * GRID_ROWS);
  const cellCounts = new Float32Array(GRID_COLS * GRID_ROWS);

  for (let y = regionStartRow + 1; y < h - 1; y++) {
    const row = Math.min(GRID_ROWS - 1, Math.floor((y - regionStartRow) / cellH));
    for (let x = 1; x < w - 1; x++) {
      const col = Math.min(GRID_COLS - 1, Math.floor(x / cellW));
      const mag = sobelAt(gray, w, x, y);
      const cellIdx = row * GRID_COLS + col;
      cellSums[cellIdx] += mag;
      cellCounts[cellIdx] += 1;
    }
  }

  const cellScores: number[] = [];
  for (let i = 0; i < cellSums.length; i++) {
    cellScores.push(cellCounts[i] > 0 ? cellSums[i] / cellCounts[i] : 0);
  }

  const meanEdge = cellScores.reduce((a, b) => a + b, 0) / cellScores.length;
  const variance = cellScores.reduce((a, b) => a + (b - meanEdge) ** 2, 0) / cellScores.length;
  const stdEdge = Math.sqrt(variance);

  let bestIdx = -1;
  let bestZ = 0;
  cellScores.forEach((s, i) => {
    const z = stdEdge > 0 ? (s - meanEdge) / stdEdge : 0;
    if (z > bestZ) {
      bestZ = z;
      bestIdx = i;
    }
  });

  if (bestIdx === -1 || bestZ < 1.2) {
    return { score: 0, bbox: null, gridRows: GRID_ROWS, gridCols: GRID_COLS, cellScores, meanEdge, stdEdge };
  }

  const row = Math.floor(bestIdx / GRID_COLS);
  const col = bestIdx % GRID_COLS;
  const bbox: [number, number, number, number] = [
    col / GRID_COLS,
    (regionStartRow + row * cellH) / h,
    1 / GRID_COLS,
    cellH / h,
  ];

  return {
    score: Math.max(0, Math.min(1, bestZ / 4)), // z=4 std devs -> score 1.0, clamped
    bbox,
    gridRows: GRID_ROWS,
    gridCols: GRID_COLS,
    cellScores,
    meanEdge,
    stdEdge,
  };
}

export const ROAD_ANOMALY_MODEL_ID = "road-anomaly-sobel-heuristic@1.0";
