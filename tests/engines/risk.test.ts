import { describe, expect, it } from "vitest";
import { computeRisk } from "@/lib/engines/risk";

describe("Risk Intelligence Engine", () => {
  it("does not conflate frequency with risk — a first-time, low-exposure incident is LOW/MEDIUM, not CRITICAL", () => {
    const result = computeRisk({
      incidentType: "wrong_parking",
      roadSegment: { id: "s", name: "Quiet Local Road", roadClass: "local", schoolNearby: false, hospitalNearby: false, junctionType: "none" },
      capturedAt: new Date("2026-01-10T11:00:00"),
      recurringIncidentCountAtLocation: 1,
      avgVisualQuality: 0.9,
    });
    expect(["LOW", "MEDIUM"]).toContain(result.level);
  });

  it("escalates to CRITICAL for a recurring, school-zone, obstruction-heavy pattern", () => {
    const result = computeRisk({
      incidentType: "school_zone_obstruction",
      roadSegment: { id: "s", name: "School Road", roadClass: "school_zone", schoolNearby: true, hospitalNearby: false, junctionType: "unsignalized" },
      capturedAt: new Date("2026-01-10T08:00:00"), // school-run peak hour
      recurringIncidentCountAtLocation: 12,
      avgVisualQuality: 0.9,
    });
    expect(result.level).toBe("CRITICAL");
  });

  it("explains every contributing factor so risk is never an opaque number", () => {
    const result = computeRisk({
      incidentType: "emergency_access_obstruction",
      roadSegment: { id: "s", name: "Hospital Road", roadClass: "arterial", schoolNearby: false, hospitalNearby: true, junctionType: "unsignalized" },
      capturedAt: new Date(),
      recurringIncidentCountAtLocation: 4,
      avgVisualQuality: 0.8,
    });
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(result.explanation.some((e) => e.toLowerCase().includes("hospital"))).toBe(true);
  });
});
