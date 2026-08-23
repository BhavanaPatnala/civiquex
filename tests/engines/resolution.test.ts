import { describe, expect, it } from "vitest";
import { checkResolution } from "@/lib/engines/resolution";

const beforeDetections = [{ label: "parked_vehicle", confidence: 0.9 }];
const beforeScene = [0.1, 0.2, -0.3, 0.4, 0.5, -0.1];

describe("Resolution Verification Engine — never trusts a self-reported status", () => {
  it("returns inconclusive (pending) when no fresh observation exists yet, regardless of what the authority claims", () => {
    const result = checkResolution({
      beforeDetections,
      afterDetections: null,
      beforeSceneDescriptor: beforeScene,
      afterSceneDescriptor: null,
      offendingLabels: ["parked_vehicle"],
    });
    expect(result.result).toBe("inconclusive");
    expect(result.confidence).toBe(0);
  });

  it("confirms likely_resolved only when the offending object is gone AND the scene is recognizably the same location", () => {
    // Deliberately a moderately-similar (not near-identical, not unrelated)
    // scene vector: same location with a genuinely changed state, landing
    // inside the engine's "well-formed" similarity band.
    const afterScene = [0.6, 0.16, -0.18, 0.24, 0.3, -0.06];
    const result = checkResolution({
      beforeDetections,
      afterDetections: [{ label: "footpath", confidence: 0.8 }],
      beforeSceneDescriptor: beforeScene,
      afterSceneDescriptor: afterScene,
      offendingLabels: ["parked_vehicle"],
    });
    expect(result.result).toBe("likely_resolved");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("reports still_present when the same offending object is detected again, contradicting an authority's closure claim", () => {
    const afterScene = beforeScene.map((v) => v * 0.9);
    const result = checkResolution({
      beforeDetections,
      afterDetections: [{ label: "parked_vehicle", confidence: 0.88 }],
      beforeSceneDescriptor: beforeScene,
      afterSceneDescriptor: afterScene,
      offendingLabels: ["parked_vehicle"],
    });
    expect(result.result).toBe("still_present");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("flags a suspiciously identical after-scene (likely a reused/stale photo) as inconclusive rather than auto-resolving", () => {
    const result = checkResolution({
      beforeDetections,
      afterDetections: [{ label: "footpath", confidence: 0.8 }],
      beforeSceneDescriptor: beforeScene,
      afterSceneDescriptor: [...beforeScene], // identical vector -> similarity ~1
      offendingLabels: ["parked_vehicle"],
    });
    expect(result.result).toBe("inconclusive");
  });
});
