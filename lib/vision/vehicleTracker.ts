// ---------------------------------------------------------------------------
// Temporal Vehicle Tracking (§2) + Identity Lock (§14, §15) + Occlusion
// Recovery (§16)
//
// A fast vehicle may be visible for only a handful of frames, so single-frame
// detection is not enough — detections are stitched into tracks so plate
// evidence can be gathered across the whole time the vehicle was visible.
//
// The safety property that matters most here is §34: FALSE PLATE ASSIGNMENT.
// Attributing vehicle B's plate to vehicle A is a critical failure, worse than
// recovering no plate at all. So whenever association is ambiguous — two
// candidates fit similarly well, or a track resumes after an occlusion gap
// without a convincing match — the track is flagged `identityUncertain`, and
// the consensus engine refuses to mark anything from it CONFIRMED.
// ---------------------------------------------------------------------------

import type { NormalizedBox, VehicleSighting, VehicleTrack } from "@/lib/vision/plateTypes";

/** Vehicle classes COCO-SSD can report that are relevant to road incidents. */
export const VEHICLE_LABELS = new Set(["car", "truck", "bus", "motorcycle", "bicycle"]);

/** Minimum overlap for a detection to continue an existing track. */
const IOU_MATCH_THRESHOLD = 0.3;
/**
 * When the best and second-best candidate tracks fit this similarly, the
 * association is genuinely ambiguous (two vehicles overlapping or crossing) —
 * we record it rather than picking one and hoping.
 */
const AMBIGUITY_MARGIN = 0.12;
/** How many consecutive frames a track may go unseen before it is closed. */
const MAX_COASTING_FRAMES = 8;

export function iou(a: NormalizedBox, b: NormalizedBox): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;
  const union = aw * ah + bw * bh - inter;
  return union <= 0 ? 0 : inter / union;
}

function centroid(box: NormalizedBox): [number, number] {
  return [box[0] + box[2] / 2, box[1] + box[3] / 2];
}

/** Predicts where a coasting track should be, from its recent velocity — used to bridge short occlusions (§16). */
function predictBox(track: MutableTrack, framesAhead: number): NormalizedBox {
  const n = track.sightings.length;
  const last = track.sightings[n - 1].box;
  if (n < 2) return last;
  const prev = track.sightings[n - 2].box;
  const [lcx, lcy] = centroid(last);
  const [pcx, pcy] = centroid(prev);
  const vx = (lcx - pcx) * framesAhead;
  const vy = (lcy - pcy) * framesAhead;
  return [last[0] + vx, last[1] + vy, last[2], last[3]];
}

interface MutableTrack {
  trackId: string;
  label: string;
  sightings: VehicleSighting[];
  lastFrameIndex: number;
  hadOcclusionGap: boolean;
  identityUncertain: boolean;
  closed: boolean;
}

export interface TrackerInput {
  /** Detections grouped by frame, in ascending frame order. */
  frames: { sightings: VehicleSighting[] }[];
}

/**
 * Associates per-frame detections into continuous vehicle tracks.
 *
 * Deliberately greedy-with-ambiguity-detection rather than a full Hungarian
 * assignment: the failure mode we must avoid is a *confident wrong* match, and
 * an explicit ambiguity flag protects against that far more directly than a
 * globally-optimal assignment that still returns one silent answer.
 */
export function trackVehicles(input: TrackerInput): VehicleTrack[] {
  const tracks: MutableTrack[] = [];
  let nextId = 1;

  input.frames.forEach((frame, frameIndex) => {
    const active = tracks.filter((t) => !t.closed);
    const claimed = new Set<MutableTrack>();

    for (const sighting of frame.sightings) {
      if (!VEHICLE_LABELS.has(sighting.label)) continue;

      // Score this detection against every active track, allowing for tracks
      // that are coasting through an occlusion.
      const scored = active
        .filter((t) => !claimed.has(t))
        .map((t) => {
          const gap = frameIndex - t.lastFrameIndex;
          const reference = gap > 1 ? predictBox(t, gap) : t.sightings[t.sightings.length - 1].box;
          // A different vehicle class is strong evidence against continuation.
          const labelPenalty = t.label === sighting.label ? 1 : 0.35;
          return { track: t, score: iou(reference, sighting.box) * labelPenalty, gap };
        })
        .sort((a, b) => b.score - a.score);

      const best = scored[0];
      const runnerUp = scored[1];

      if (best && best.score >= IOU_MATCH_THRESHOLD) {
        // Two tracks fit this detection almost equally well — we cannot prove
        // which vehicle this is, so both sides inherit the doubt (§15).
        const ambiguous = !!runnerUp && runnerUp.score >= IOU_MATCH_THRESHOLD && best.score - runnerUp.score < AMBIGUITY_MARGIN;
        if (ambiguous) {
          best.track.identityUncertain = true;
          runnerUp.track.identityUncertain = true;
        }
        if (best.gap > 1) {
          best.track.hadOcclusionGap = true;
          // Re-association across a gap is only trustworthy with a strong fit.
          if (best.score < 0.5) best.track.identityUncertain = true;
        }
        best.track.sightings.push(sighting);
        best.track.lastFrameIndex = frameIndex;
        claimed.add(best.track);
      } else {
        tracks.push({
          trackId: `V-${String(nextId++).padStart(3, "0")}`,
          label: sighting.label,
          sightings: [sighting],
          lastFrameIndex: frameIndex,
          hadOcclusionGap: false,
          identityUncertain: false,
          closed: false,
        });
      }
    }

    for (const t of tracks) {
      if (!t.closed && frameIndex - t.lastFrameIndex > MAX_COASTING_FRAMES) t.closed = true;
    }
  });

  return tracks.map(({ trackId, label, sightings, hadOcclusionGap, identityUncertain }) => ({
    trackId,
    label,
    sightings,
    hadOcclusionGap,
    identityUncertain,
  }));
}

/**
 * Picks the track most likely to be the offending vehicle for an incident:
 * the one visible longest and most confidently around the event. Returns null
 * rather than guessing when nothing was tracked — "no vehicle identified" is a
 * valid, honest outcome.
 */
export function selectPrimaryTrack(tracks: VehicleTrack[]): VehicleTrack | null {
  if (tracks.length === 0) return null;
  return [...tracks].sort((a, b) => {
    const aScore = a.sightings.length * avgConfidence(a);
    const bScore = b.sightings.length * avgConfidence(b);
    return bScore - aScore;
  })[0];
}

function avgConfidence(track: VehicleTrack): number {
  if (track.sightings.length === 0) return 0;
  return track.sightings.reduce((sum, s) => sum + s.confidence, 0) / track.sightings.length;
}

/**
 * Verifies a plate region actually sits within (or just below) the tracked
 * vehicle's box in that frame — the geometric half of the identity lock (§14).
 * A plate floating outside the offender's bounding box belongs to a different
 * vehicle and must never be attributed to this one.
 */
export function plateBelongsToVehicle(plateBox: NormalizedBox, vehicleBox: NormalizedBox): boolean {
  const [px, py, pw, ph] = plateBox;
  const [vx, vy, vw, vh] = vehicleBox;
  const [pcx, pcy] = centroid(plateBox);
  // Allow a small vertical tolerance: plates sit low and detectors often clip
  // the bumper, but horizontally the plate must be inside the vehicle.
  const withinX = pcx >= vx && pcx <= vx + vw;
  const withinY = pcy >= vy && pcy <= vy + vh * 1.12;
  const plateIsSmaller = pw * ph < vw * vh;
  return withinX && withinY && plateIsSmaller;
}
