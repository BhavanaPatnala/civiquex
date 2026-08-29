import { describe, expect, it } from "vitest";
import { adversarialSelfCheck, assessPlateEvidence, countIndependentObservations, explainPlateDecision } from "@/lib/vision/plateEvidence";
import { buildPlateConsensus } from "@/lib/vision/plateConsensus";
import type { FrameQualityScores, PlateObservation, VehicleSighting, VehicleTrack } from "@/lib/vision/plateTypes";

const GOOD: FrameQualityScores = { sharpness: 0.9, motionBlur: 0.9, exposure: 0.85, contrast: 0.8, glare: 0.95, overall: 88 };
const DEGRADED: FrameQualityScores = { sharpness: 0.3, motionBlur: 0.25, exposure: 0.4, contrast: 0.35, glare: 0.3, overall: 30 };

function obs(text: string, t: number, quality: FrameQualityScores = GOOD, platePixelWidth = 170): PlateObservation {
  return {
    provenance: { sourceMediaHash: "h", frameIndex: Math.round(t * 30), sourceTimeSeconds: t },
    text,
    charConfidences: Array.from({ length: text.length }, () => 0.93),
    ocrConfidence: 0.93,
    quality,
    plateBox: [0.4, 0.6, 0.12, 0.04],
    platePixelWidth,
  };
}

function sighting(frameIndex: number, confidence = 0.93): VehicleSighting {
  return {
    provenance: { sourceMediaHash: "h", frameIndex, sourceTimeSeconds: frameIndex / 30 },
    box: [0.3, 0.4, 0.2, 0.2],
    confidence,
    label: "car",
  };
}

function track(overrides: Partial<VehicleTrack> = {}): VehicleTrack {
  return {
    trackId: "V-001",
    label: "car",
    sightings: [sighting(0), sighting(1), sighting(2), sighting(3)],
    hadOcclusionGap: false,
    identityUncertain: false,
    ...overrides,
  };
}

describe("countIndependentObservations — redundancy control (§4)", () => {
  it("does not count near-identical consecutive frames as independent corroboration", () => {
    const obsList = [obs("TN09AB1234", 1.00), obs("TN09AB1234", 1.03), obs("TN09AB1234", 1.06)];
    expect(countIndependentObservations(obsList)).toBe(1);
  });

  it("counts genuinely separated observations independently", () => {
    const obsList = [obs("TN09AB1234", 1.0), obs("TN09AB1234", 1.6), obs("TN09AB1234", 2.4)];
    expect(countIndependentObservations(obsList)).toBe(3);
  });
});

describe("assessPlateEvidence — sufficiency + abstention", () => {
  it("confirms only when independent, high-quality frames agree on every character", () => {
    const result = assessPlateEvidence({
      track: track(),
      observations: [obs("TN09AB1234", 0.2), obs("TN09AB1234", 0.9), obs("TN09AB1234", 1.7)],
    });
    expect(result.decision).toBe("CONFIRMED");
    expect(result.plate).toBe("TN09AB1234");
    expect(result.evidenceQuality).toBeGreaterThanOrEqual(70);
    expect(result.bestFrame).not.toBeNull();
  });

  it("CRITICAL: refuses to confirm when the vehicle track identity was uncertain", () => {
    const result = assessPlateEvidence({
      track: track({ identityUncertain: true }),
      observations: [obs("TN09AB1234", 0.2), obs("TN09AB1234", 0.9), obs("TN09AB1234", 1.7)],
    });
    expect(result.decision).toBe("REVIEW_REQUIRED");
    expect(result.breakdown.identity).toBeLessThan(0.5);
  });

  it("refuses to confirm when a nearby vehicle's plate region had to be discarded", () => {
    const result = assessPlateEvidence({
      track: track(),
      observations: [obs("TN09AB1234", 0.2), obs("TN09AB1234", 0.9), obs("TN09AB1234", 1.7)],
      rejectedForGeometry: 2,
    });
    expect(result.decision).toBe("REVIEW_REQUIRED");
    expect(result.reasoning.some((r) => r.detail.includes("outside this vehicle's outline"))).toBe(true);
  });

  it("refuses to confirm off many near-duplicate frames of a single instant", () => {
    const result = assessPlateEvidence({
      track: track(),
      observations: [obs("TN09AB1234", 1.0), obs("TN09AB1234", 1.03), obs("TN09AB1234", 1.06), obs("TN09AB1234", 1.09)],
    });
    expect(result.decision).toBe("REVIEW_REQUIRED");
  });

  it("does not confirm when every contributing frame was degraded, even if they agree", () => {
    const result = assessPlateEvidence({
      track: track(),
      observations: [obs("TN09AB1234", 0.2, DEGRADED), obs("TN09AB1234", 1.0, DEGRADED), obs("TN09AB1234", 1.9, DEGRADED)],
    });
    expect(result.decision).not.toBe("CONFIRMED");
  });

  it("abstains with UNREADABLE rather than guessing when nothing is legible", () => {
    const result = assessPlateEvidence({ track: track(), observations: [] });
    expect(result.decision).toBe("UNREADABLE");
    expect(result.plate).toBeNull();
  });

  it("stamps model/processing versions onto every result for auditability (§25, §37)", () => {
    const result = assessPlateEvidence({ track: track(), observations: [obs("TN09AB1234", 0.2), obs("TN09AB1234", 1.2)] });
    expect(result.versions.consensus).toBeTruthy();
    expect(result.versions.ocr).toBeTruthy();
    expect(result.versions.tracker).toBeTruthy();
  });

  it("records provenance for the best frame and every supporting frame", () => {
    const result = assessPlateEvidence({
      track: track(),
      observations: [obs("TN09AB1234", 0.2, DEGRADED), obs("TN09AB1234", 1.2, GOOD)],
    });
    // Best frame must be the higher-quality one, not simply the first.
    expect(result.bestFrame?.sourceTimeSeconds).toBe(1.2);
    expect(result.supportingFrames).toHaveLength(2);
  });
});

describe("adversarialSelfCheck (§19)", () => {
  it("raises the track-switch question when identity was uncertain", () => {
    const observations = [obs("TN09AB1234", 0.2), obs("TN09AB1234", 1.2)];
    const consensus = buildPlateConsensus({ observations, identityUncertain: true });
    const concerns = adversarialSelfCheck({ track: track({ identityUncertain: true }), observations }, consensus);
    expect(concerns.some((c) => c.code === "IDENTITY_UNCERTAIN")).toBe(true);
  });

  it("raises the look-alike question when a position stayed unresolved between confusables", () => {
    const observations = [obs("TN09AB1234", 0.2), obs("TN09A81234", 1.2)];
    const consensus = buildPlateConsensus({ observations });
    const concerns = adversarialSelfCheck({ track: track(), observations }, consensus);
    expect(concerns.some((c) => c.code === "CONFUSABLE_AMBIGUITY")).toBe(true);
  });

  it("finds nothing to object to in genuinely clean, independent evidence", () => {
    const observations = [obs("TN09AB1234", 0.2), obs("TN09AB1234", 1.2), obs("TN09AB1234", 2.2)];
    const consensus = buildPlateConsensus({ observations });
    expect(adversarialSelfCheck({ track: track(), observations }, consensus)).toHaveLength(0);
  });
});

describe("explainPlateDecision (§26)", () => {
  it("produces plain-language lines with no model internals", () => {
    const result = assessPlateEvidence({
      track: track(),
      observations: [obs("TN09AB1234", 0.2), obs("TN09AB1234", 1.2), obs("TN09AB1234", 2.2)],
    });
    const lines = explainPlateDecision(result);
    expect(lines.join(" ")).toContain("Character agreement: 10/10");
    expect(lines.join(" ")).toContain("Evidence quality:");
    expect(lines.join(" ")).not.toMatch(/tensor|softmax|logit/i);
  });
});
