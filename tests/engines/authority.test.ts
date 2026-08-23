import { describe, expect, it } from "vitest";
import { resolveAuthority, type AuthorityCandidate, type RoutingFeedbackRecord } from "@/lib/engines/authority";

const rect = (minLng: number, minLat: number, maxLng: number, maxLat: number): [number, number][] => [
  [minLng, minLat],
  [maxLng, minLat],
  [maxLng, maxLat],
  [minLng, maxLat],
  [minLng, minLat],
];

const trafficPolice: AuthorityCandidate = {
  id: "traffic-police",
  name: "Traffic Police",
  jurisdiction: "City",
  supportedIncidentTypes: ["footpath_obstruction", "wrong_parking"],
  boundaries: [rect(80.2, 12.9, 80.3, 13.1)],
  apiAvailable: false,
  submissionMethod: "assisted_manual",
};

const municipal: AuthorityCandidate = {
  id: "municipal",
  name: "Municipal Corporation Zone 9",
  jurisdiction: "Zone 9",
  supportedIncidentTypes: ["footpath_obstruction"],
  boundaries: [rect(80.22, 13.03, 80.24, 13.05)],
  apiAvailable: false,
  submissionMethod: "assisted_manual",
};

describe("Authority Resolution Engine", () => {
  it("never fabricates a submission channel — reports unavailable when no boundary covers the location", () => {
    const result = resolveAuthority({
      point: { lat: 0, lng: 0 },
      incidentType: "footpath_obstruction",
      roadSegmentId: "seg-1",
      authorities: [trafficPolice, municipal],
      feedback: [],
    });
    expect(result.authorityId).toBeNull();
    expect(result.submissionMethod).toBe("unavailable");
    expect(result.decisionTrail.join(" ")).toMatch(/unavailable/i);
  });

  it("reports unavailable when the location is covered but no authority supports this incident type", () => {
    const result = resolveAuthority({
      point: { lat: 13.04, lng: 80.23 },
      incidentType: "hazardous_interaction",
      roadSegmentId: "seg-1",
      authorities: [municipal],
      feedback: [],
    });
    expect(result.authorityId).toBeNull();
  });

  it("learns from repeated 'wrong department' redirects and routes future reports directly to the correct authority", () => {
    // Without history: falls back to whichever candidate is listed first.
    const before = resolveAuthority({
      point: { lat: 13.04, lng: 80.23 },
      incidentType: "footpath_obstruction",
      roadSegmentId: "road-x",
      authorities: [trafficPolice, municipal],
      feedback: [],
    });
    expect(before.authorityId).toBe(trafficPolice.id);
    expect(before.learnedOverride).toBe(false);

    const feedback: RoutingFeedbackRecord[] = Array.from({ length: 4 }, () => ({
      authorityId: trafficPolice.id,
      outcome: "redirected",
      redirectedToId: municipal.id,
      roadSegmentId: "road-x",
      incidentType: "footpath_obstruction",
    }));

    const after = resolveAuthority({
      point: { lat: 13.04, lng: 80.23 },
      incidentType: "footpath_obstruction",
      roadSegmentId: "road-x",
      authorities: [trafficPolice, municipal],
      feedback,
    });

    expect(after.authorityId).toBe(municipal.id);
    expect(after.learnedOverride).toBe(true);
    expect(after.decisionTrail.some((line) => line.includes("redirected"))).toBe(true);
  });

  it("keeps routing decisions auditable — every resolution returns a non-empty, human-readable decision trail", () => {
    const result = resolveAuthority({
      point: { lat: 13.04, lng: 80.23 },
      incidentType: "footpath_obstruction",
      roadSegmentId: "road-x",
      authorities: [trafficPolice, municipal],
      feedback: [],
    });
    expect(result.decisionTrail.length).toBeGreaterThan(0);
  });
});
