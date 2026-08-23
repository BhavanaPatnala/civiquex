import { describe, expect, it } from "vitest";
import { correlateObservation, CORRELATION_JOIN_THRESHOLD, scoreObservationPair } from "@/lib/engines/correlation";
import type { ObservationLite } from "@/lib/types";

function makeObs(overrides: Partial<ObservationLite>): ObservationLite {
  return {
    id: "obs-1",
    sourceType: "CITIZEN",
    incidentTypeGuess: "wrong_parking",
    capturedAt: "2026-01-10T08:42:03.000Z",
    lat: 13.06,
    lng: 80.25,
    orientationDeg: 40,
    roadSegmentId: "seg-1",
    vehicleFingerprint: null,
    sceneDescriptor: [0.1, 0.2, 0.3, 0.4],
    detections: [{ label: "parked_vehicle", confidence: 0.9 }],
    visualQuality: 0.9,
    ...overrides,
  };
}

describe("Incident Graph correlation engine", () => {
  it("joins three independent, asynchronous observations of the same real-world event into one incident", () => {
    // Mirrors the spec's canonical example: citizen at 08:42:03, second
    // citizen at 08:42:11, authorized sensor at 08:42:18 — same spot, same
    // direction of travel, same incident type.
    const anchor = makeObs({ id: "a", capturedAt: "2026-01-10T08:42:03.000Z", lat: 13.0600, lng: 80.2500, orientationDeg: 40 });
    const second = makeObs({ id: "b", capturedAt: "2026-01-10T08:42:11.000Z", lat: 13.06005, lng: 80.25004, orientationDeg: 46 });
    const third = makeObs({ id: "c", capturedAt: "2026-01-10T08:42:18.000Z", lat: 13.06003, lng: 80.24997, orientationDeg: 220 });

    const r1 = correlateObservation(second, [{ incidentId: "INC-1", incidentType: "wrong_parking", roadSegmentId: "seg-1", anchorObservation: anchor }]);
    expect(r1.incidentId).toBe("INC-1");
    expect(r1.score).toBeGreaterThanOrEqual(CORRELATION_JOIN_THRESHOLD);

    const r2 = correlateObservation(third, [{ incidentId: "INC-1", incidentType: "wrong_parking", roadSegmentId: "seg-1", anchorObservation: second }]);
    expect(r2.incidentId).toBe("INC-1");
  });

  it("does NOT merge two unrelated events that merely happen to be nearby, once time/space diverge", () => {
    const anchor = makeObs({ id: "a", capturedAt: "2026-01-10T08:00:00.000Z", lat: 13.0600, lng: 80.2500 });
    const unrelated = makeObs({
      id: "z",
      capturedAt: "2026-01-10T09:15:00.000Z", // 75 minutes later
      lat: 13.09, // ~3km away
      lng: 80.29,
    });

    const result = correlateObservation(unrelated, [{ incidentId: "INC-1", incidentType: "wrong_parking", roadSegmentId: "seg-1", anchorObservation: anchor }]);
    expect(result.incidentId).toBeNull();
    expect(result.score).toBeLessThan(CORRELATION_JOIN_THRESHOLD);
  });

  it("requires matching incident type — a footpath obstruction does not merge into a wrong-parking incident even at the same place/time", () => {
    const anchor = makeObs({ id: "a", incidentTypeGuess: "wrong_parking" });
    const other = makeObs({ id: "b", incidentTypeGuess: "footpath_obstruction", capturedAt: "2026-01-10T08:42:05.000Z" });

    const { score } = scoreObservationPair(anchor, other);
    expect(score).toBeLessThan(CORRELATION_JOIN_THRESHOLD);
  });

  it("starts a new incident when there are no open candidates nearby", () => {
    const result = correlateObservation(makeObs({}), []);
    expect(result.incidentId).toBeNull();
  });
});
