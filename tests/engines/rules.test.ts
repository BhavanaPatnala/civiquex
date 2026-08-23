import { describe, expect, it } from "vitest";
import { evaluateRule } from "@/lib/engines/rules";
import type { RuleDef } from "@/lib/types";

const arterialNoParkingRule: RuleDef = {
  id: "rule-1",
  code: "TN-MVR-WP-01",
  incidentType: "wrong_parking",
  description: "No parking on arterial roads 08:00-20:00",
  conditions: { roadClasses: ["arterial"], timeWindows: [{ startHour: 8, endHour: 20 }], minVisualConfidence: 0.5 },
  authoritySource: "Demo regulation",
};

const detections = [{ label: "parked_vehicle", confidence: 0.85 }];

describe("Context / Rule Engine — same visual scene, different legality", () => {
  it("flags a potential violation when parked on an arterial road during the restricted window", () => {
    const result = evaluateRule({
      incidentType: "wrong_parking",
      capturedAt: new Date("2026-01-10T14:00:00"),
      roadSegment: { id: "seg-1", name: "Anna Salai", roadClass: "arterial", schoolNearby: false, hospitalNearby: false, junctionType: "signalized" },
      detections,
      visualQuality: 0.9,
      candidateRules: [arterialNoParkingRule],
    });
    expect(result.verdict).toBe("potential_violation");
    expect(result.matchedRule?.code).toBe("TN-MVR-WP-01");
  });

  it("does NOT flag the identical visual scene at 11pm — outside the restricted window", () => {
    const result = evaluateRule({
      incidentType: "wrong_parking",
      capturedAt: new Date("2026-01-10T23:00:00"),
      roadSegment: { id: "seg-1", name: "Anna Salai", roadClass: "arterial", schoolNearby: false, hospitalNearby: false, junctionType: "signalized" },
      detections,
      visualQuality: 0.9,
      candidateRules: [arterialNoParkingRule],
    });
    expect(result.verdict).not.toBe("potential_violation");
  });

  it("does NOT flag the identical visual scene on a local road, even during the restricted hours", () => {
    const result = evaluateRule({
      incidentType: "wrong_parking",
      capturedAt: new Date("2026-01-10T14:00:00"),
      roadSegment: { id: "seg-2", name: "GN Chetty Road", roadClass: "local", schoolNearby: false, hospitalNearby: false, junctionType: "none" },
      detections,
      visualQuality: 0.9,
      candidateRules: [arterialNoParkingRule],
    });
    expect(result.verdict).not.toBe("potential_violation");
  });

  it("never asserts a violation from vision alone — low-quality evidence is insufficient regardless of context match", () => {
    const result = evaluateRule({
      incidentType: "wrong_parking",
      capturedAt: new Date("2026-01-10T14:00:00"),
      roadSegment: { id: "seg-1", name: "Anna Salai", roadClass: "arterial", schoolNearby: false, hospitalNearby: false, junctionType: "signalized" },
      detections: [{ label: "parked_vehicle", confidence: 0.2 }],
      visualQuality: 0.3,
      candidateRules: [arterialNoParkingRule],
    });
    expect(result.verdict).toBe("evidence_insufficient");
  });

  it("requests manual verification when no codified rule exists for the incident type", () => {
    const result = evaluateRule({
      incidentType: "some_unknown_type",
      capturedAt: new Date(),
      roadSegment: null,
      detections,
      visualQuality: 0.9,
      candidateRules: [],
    });
    expect(result.verdict).toBe("requires_verification");
    expect(result.matchedRule).toBeNull();
  });
});
