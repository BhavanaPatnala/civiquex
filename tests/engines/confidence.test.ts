import { describe, expect, it } from "vitest";
import { computeEvidenceConfidence } from "@/lib/engines/confidence";

const base = {
  visualQuality: 0.9,
  avgDetectionConfidence: 0.85,
  roadSegmentMatched: true,
  gpsAccuracyMeters: 8,
  uploadDelaySeconds: 5,
  ruleConfidence: 0.9,
  corroboratingObservationCount: 0,
};

describe("Evidence Confidence Engine", () => {
  it("decomposes confidence into independently explainable factors that sum to a bounded overall score", () => {
    const result = computeEvidenceConfidence(base);
    for (const key of ["visual", "location", "temporal", "rule", "scene", "corroboration"] as const) {
      expect(result.breakdown[key]).toBeGreaterThanOrEqual(0);
      expect(result.breakdown[key]).toBeLessThanOrEqual(1);
    }
    expect(result.overall).toBeGreaterThan(0);
    expect(result.overall).toBeLessThanOrEqual(1);
    expect(result.explanation).toHaveLength(6);
  });

  it("increases corroboration confidence as independent observations accumulate, with diminishing returns", () => {
    const zero = computeEvidenceConfidence({ ...base, corroboratingObservationCount: 0 });
    const one = computeEvidenceConfidence({ ...base, corroboratingObservationCount: 1 });
    const three = computeEvidenceConfidence({ ...base, corroboratingObservationCount: 3 });

    expect(one.breakdown.corroboration).toBeGreaterThan(zero.breakdown.corroboration);
    expect(three.breakdown.corroboration).toBeGreaterThan(one.breakdown.corroboration);
    // Diminishing returns: the jump from 0->1 should exceed the jump from 1->3 per added observation.
    const firstJump = one.breakdown.corroboration - zero.breakdown.corroboration;
    const perObsLaterJump = (three.breakdown.corroboration - one.breakdown.corroboration) / 2;
    expect(firstJump).toBeGreaterThan(perObsLaterJump);
  });

  it("labels a single, low-quality, uncorroborated observation as insufficient rather than a confident violation", () => {
    const result = computeEvidenceConfidence({
      visualQuality: 0.4,
      avgDetectionConfidence: 0.35,
      roadSegmentMatched: false,
      gpsAccuracyMeters: 45,
      uploadDelaySeconds: 600,
      ruleConfidence: 0.3,
      corroboratingObservationCount: 0,
    });
    expect(result.label).toBe("insufficient");
  });

  it("penalizes a large gap between capture and upload as reduced temporal trust", () => {
    const prompt = computeEvidenceConfidence({ ...base, uploadDelaySeconds: 2 });
    const delayed = computeEvidenceConfidence({ ...base, uploadDelaySeconds: 800 });
    expect(delayed.breakdown.temporal).toBeLessThan(prompt.breakdown.temporal);
  });
});
