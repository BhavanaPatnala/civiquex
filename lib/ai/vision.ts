// ---------------------------------------------------------------------------
// VisionProvider — DEMO inference stub.
//
// This is NOT a trained model. There is no benchmarked CV model wired into
// this build (per the project rule: never claim a model is accurate unless
// benchmarked). It is a deterministic, seeded stand-in that turns captured
// evidence (media hash + declared incident type + capture context) into the
// same shape of output a real object-detection/scene-understanding model
// would produce, so the rest of the pipeline (correlation, confidence, rule
// gating, resolution comparison) can be built, tested, and demoed against a
// stable contract.
//
// Every result carries model/version/timestamp/input-reference/explanation
// metadata and the UI always renders a "DEMO MODEL" badge next to it — see
// components/evidence/model-badge.tsx. Swapping in a real model means
// implementing this same VisionProvider interface against a real inference
// endpoint; no other module needs to change.
// ---------------------------------------------------------------------------

export const VISION_MODEL_NAME = "civiquex-demo-cv-stub";
export const VISION_MODEL_VERSION = "0.3.0-demo";

export interface Detection {
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // x, y, w, h as fraction of frame
}

export interface VisionResult {
  model: string;
  modelVersion: string;
  inputRef: string;
  generatedAt: string;
  detections: Detection[];
  sceneDescriptor: number[]; // 16-dim demo embedding, used for similarity
  visualQuality: number; // 0-1, stands in for blur/lighting/framing quality
  explanation: string;
}

// deterministic string hash -> 32-bit int
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 seeded PRNG — deterministic given the same seed
function mulberry32(seed: number) {
  let a = seed;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INCIDENT_TYPE_LABELS: Record<string, string[]> = {
  wrong_parking: ["parked_vehicle", "no_parking_sign", "road_marking"],
  footpath_obstruction: ["parked_vehicle", "footpath", "pedestrian_path_blocked"],
  bus_stop_obstruction: ["parked_vehicle", "bus_stop_sign", "bus_bay_marking"],
  emergency_access_obstruction: ["parked_vehicle", "emergency_access_sign", "driveway"],
  school_zone_obstruction: ["parked_vehicle", "school_zone_sign", "children_present_area"],
  accessible_parking_obstruction: ["parked_vehicle", "accessible_parking_sign"],
  signage_obstruction: ["damaged_sign", "obscured_sign", "traffic_signal"],
  dangerous_obstruction: ["obstruction_object", "narrowed_carriageway"],
  hazardous_interaction: ["pedestrian", "vehicle", "near_miss_trajectory"],
};

/**
 * Deterministic "inference" over a piece of evidence. Given the same
 * mediaRef, incidentTypeGuess and capturedAt, always returns the same
 * result — this stands in for a real model's determinism and makes the
 * whole pipeline testable end to end.
 */
export function runVisionInference(input: {
  mediaRef: string;
  incidentTypeGuess: string;
  capturedAt: string;
}): VisionResult {
  const seed = hashString(`${input.mediaRef}|${input.incidentTypeGuess}|${input.capturedAt}`);
  const rand = mulberry32(seed);

  const labels = INCIDENT_TYPE_LABELS[input.incidentTypeGuess] ?? ["object"];
  const detections: Detection[] = labels.map((label, i) => {
    const base = 0.7 + rand() * 0.28;
    return {
      label,
      confidence: Math.min(0.99, base - i * 0.03),
      bbox: [
        Number((0.1 + rand() * 0.5).toFixed(3)),
        Number((0.1 + rand() * 0.5).toFixed(3)),
        Number((0.15 + rand() * 0.35).toFixed(3)),
        Number((0.15 + rand() * 0.35).toFixed(3)),
      ],
    };
  });

  const sceneDescriptor = Array.from({ length: 16 }, () => Number((rand() * 2 - 1).toFixed(4)));
  const visualQuality = Number((0.72 + rand() * 0.26).toFixed(3));

  return {
    model: VISION_MODEL_NAME,
    modelVersion: VISION_MODEL_VERSION,
    inputRef: input.mediaRef,
    generatedAt: new Date().toISOString(),
    detections,
    sceneDescriptor,
    visualQuality,
    explanation: `Detected ${detections.map((d) => d.label).join(", ")} consistent with a reported "${input.incidentTypeGuess.replaceAll("_", " ")}" scenario. Demo model — not benchmarked, for pipeline demonstration only.`,
  };
}

/** Cosine similarity between two scene descriptors, used by correlation + resolution engines. */
export function sceneSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.max(0, Math.min(1, (cos + 1) / 2));
}
