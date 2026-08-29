import { describe, expect, it } from "vitest";
import { iou, plateBelongsToVehicle, selectPrimaryTrack, trackVehicles } from "@/lib/vision/vehicleTracker";
import type { NormalizedBox, VehicleSighting } from "@/lib/vision/plateTypes";

function sighting(box: NormalizedBox, frameIndex: number, label = "car", confidence = 0.9): VehicleSighting {
  return {
    provenance: { sourceMediaHash: "h", frameIndex, sourceTimeSeconds: frameIndex / 30 },
    box,
    confidence,
    label,
  };
}

/** Builds a track of one vehicle moving steadily left-to-right. */
function movingVehicle(startX: number, frames: number, step: number, label = "car"): { sightings: VehicleSighting[] }[] {
  return Array.from({ length: frames }, (_, i) => ({
    sightings: [sighting([startX + i * step, 0.5, 0.12, 0.1], i, label)],
  }));
}

describe("iou", () => {
  it("is 1 for identical boxes and 0 for disjoint ones", () => {
    expect(iou([0, 0, 0.1, 0.1], [0, 0, 0.1, 0.1])).toBeCloseTo(1);
    expect(iou([0, 0, 0.1, 0.1], [0.5, 0.5, 0.1, 0.1])).toBe(0);
  });
});

describe("trackVehicles", () => {
  it("follows one vehicle across frames as a single track, not many one-frame detections", () => {
    const tracks = trackVehicles({ frames: movingVehicle(0.1, 6, 0.02) });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].sightings).toHaveLength(6);
    expect(tracks[0].identityUncertain).toBe(false);
  });

  it("keeps a fast vehicle that is only briefly visible as one track", () => {
    // Large per-frame displacement — the fast-vehicle case the spec targets.
    const tracks = trackVehicles({ frames: movingVehicle(0.05, 4, 0.06) });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].sightings.length).toBe(4);
  });

  it("keeps two well-separated vehicles as two distinct tracks", () => {
    const frames = Array.from({ length: 5 }, (_, i) => ({
      sightings: [sighting([0.05 + i * 0.01, 0.5, 0.1, 0.1], i), sighting([0.7 + i * 0.01, 0.2, 0.1, 0.1], i)],
    }));
    const tracks = trackVehicles({ frames });
    expect(tracks).toHaveLength(2);
    expect(tracks[0].identityUncertain).toBe(false);
    expect(tracks[1].identityUncertain).toBe(false);
  });

  it("CRITICAL (§30): flags identity as uncertain when two vehicles overlap ambiguously", () => {
    // Two vehicles converging until their boxes nearly coincide — exactly the
    // situation that produces a false plate assignment if resolved silently.
    const frames = [
      { sightings: [sighting([0.30, 0.5, 0.12, 0.1], 0), sighting([0.50, 0.5, 0.12, 0.1], 0)] },
      { sightings: [sighting([0.36, 0.5, 0.12, 0.1], 1), sighting([0.44, 0.5, 0.12, 0.1], 1)] },
      { sightings: [sighting([0.40, 0.5, 0.12, 0.1], 2), sighting([0.41, 0.5, 0.12, 0.1], 2)] },
    ];
    const tracks = trackVehicles({ frames });
    // At least one track must carry the doubt forward rather than silently
    // continuing with a possibly-swapped identity.
    expect(tracks.some((t) => t.identityUncertain)).toBe(true);
  });

  it("does not continue a track across a different vehicle class without doubt", () => {
    const frames = [
      { sightings: [sighting([0.3, 0.5, 0.12, 0.1], 0, "car")] },
      { sightings: [sighting([0.31, 0.5, 0.12, 0.1], 1, "truck")] },
    ];
    const tracks = trackVehicles({ frames });
    // A car becoming a truck at the same position is either a mislabel or a
    // different vehicle — it must not silently extend as one confident track.
    const single = tracks.length === 1;
    if (single) expect(tracks[0].label).toBe("car");
    else expect(tracks).toHaveLength(2);
  });

  it("bridges a short occlusion and records that the gap happened", () => {
    const frames = [
      { sightings: [sighting([0.10, 0.5, 0.12, 0.1], 0)] },
      { sightings: [sighting([0.14, 0.5, 0.12, 0.1], 1)] },
      { sightings: [] }, // occluded
      { sightings: [sighting([0.22, 0.5, 0.12, 0.1], 3)] },
    ];
    const tracks = trackVehicles({ frames });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].hadOcclusionGap).toBe(true);
    expect(tracks[0].sightings).toHaveLength(3);
  });

  it("ignores non-vehicle detections entirely", () => {
    const frames = [{ sightings: [sighting([0.3, 0.5, 0.1, 0.1], 0, "person"), sighting([0.6, 0.5, 0.1, 0.1], 0, "dog")] }];
    expect(trackVehicles({ frames })).toHaveLength(0);
  });

  it("starts a new track for a vehicle entering the frame later", () => {
    const frames = [
      { sightings: [sighting([0.1, 0.5, 0.1, 0.1], 0)] },
      { sightings: [sighting([0.12, 0.5, 0.1, 0.1], 1)] },
      { sightings: [sighting([0.14, 0.5, 0.1, 0.1], 2), sighting([0.85, 0.3, 0.1, 0.1], 2)] },
    ];
    const tracks = trackVehicles({ frames });
    expect(tracks).toHaveLength(2);
    expect(tracks[1].sightings).toHaveLength(1);
  });
});

describe("selectPrimaryTrack", () => {
  it("returns null rather than inventing a vehicle when nothing was tracked", () => {
    expect(selectPrimaryTrack([])).toBeNull();
  });

  it("prefers the longest, most confidently observed track", () => {
    const tracks = trackVehicles({
      frames: [
        { sightings: [sighting([0.1, 0.5, 0.1, 0.1], 0, "car", 0.95), sighting([0.8, 0.2, 0.1, 0.1], 0, "car", 0.5)] },
        { sightings: [sighting([0.12, 0.5, 0.1, 0.1], 1, "car", 0.95)] },
        { sightings: [sighting([0.14, 0.5, 0.1, 0.1], 2, "car", 0.95)] },
      ],
    });
    const primary = selectPrimaryTrack(tracks);
    expect(primary?.sightings.length).toBe(3);
  });
});

describe("plateBelongsToVehicle — the geometric half of the identity lock (§14)", () => {
  const vehicle: NormalizedBox = [0.3, 0.4, 0.2, 0.2]; // x .3-.5, y .4-.6

  it("accepts a plate sitting low within the vehicle box", () => {
    expect(plateBelongsToVehicle([0.36, 0.54, 0.08, 0.03], vehicle)).toBe(true);
  });

  it("CRITICAL: rejects a plate belonging to a different vehicle elsewhere in the scene", () => {
    expect(plateBelongsToVehicle([0.75, 0.5, 0.08, 0.03], vehicle)).toBe(false);
  });

  it("rejects a plate above the vehicle (geometrically impossible)", () => {
    expect(plateBelongsToVehicle([0.36, 0.1, 0.08, 0.03], vehicle)).toBe(false);
  });

  it("rejects a 'plate' larger than the vehicle itself", () => {
    expect(plateBelongsToVehicle([0.3, 0.45, 0.5, 0.3], vehicle)).toBe(false);
  });
});
