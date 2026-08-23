import { describe, expect, it } from "vitest";
import { detectRoadAnomaly } from "@/lib/client/roadAnomaly";

function makeImage(w: number, h: number, fill: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
}

describe("Road-surface anomaly heuristic (real Sobel edge analysis)", () => {
  it("reports no anomaly on a perfectly uniform road surface", () => {
    const flat = makeImage(64, 48, () => 120);
    const result = detectRoadAnomaly(flat);
    expect(result.score).toBe(0);
    expect(result.bbox).toBeNull();
  });

  it("flags a sharp localized discontinuity in the road region as an anomaly candidate", () => {
    const withCrack = makeImage(64, 48, (x, y) => {
      // A bright vertical stripe in the lower-left quadrant against an otherwise flat road.
      if (y > 30 && x > 8 && x < 12) return 250;
      return 100;
    });
    const result = detectRoadAnomaly(withCrack);
    expect(result.score).toBeGreaterThan(0);
    expect(result.bbox).not.toBeNull();
  });

  it("ignores discontinuities above the road region (sky/horizon)", () => {
    const skyOnly = makeImage(64, 48, (x, y) => {
      if (y < 10 && x > 8 && x < 12) return 250; // well above the 40% road-region cutoff
      return 100;
    });
    const result = detectRoadAnomaly(skyOnly);
    expect(result.score).toBe(0);
  });
});
