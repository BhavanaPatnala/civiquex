import { describe, expect, it } from "vitest";
import { areConfusable, buildPlateConsensus, MIN_PLATE_PIXEL_WIDTH, normalizePlateText } from "@/lib/vision/plateConsensus";
import { UNKNOWN_CHAR, type FrameQualityScores, type PlateObservation } from "@/lib/vision/plateTypes";

const GOOD_QUALITY: FrameQualityScores = { sharpness: 0.9, motionBlur: 0.9, exposure: 0.85, contrast: 0.8, glare: 0.95, overall: 88 };

function obs(text: string, opts: Partial<PlateObservation> & { charConf?: number } = {}): PlateObservation {
  const charConf = opts.charConf ?? 0.92;
  return {
    provenance: {
      sourceMediaHash: "hash",
      frameIndex: opts.provenance?.frameIndex ?? 0,
      sourceTimeSeconds: opts.provenance?.sourceTimeSeconds ?? 0,
    },
    text,
    charConfidences: Array.from({ length: text.length }, () => charConf),
    ocrConfidence: opts.ocrConfidence ?? charConf,
    quality: opts.quality ?? GOOD_QUALITY,
    plateBox: [0.4, 0.6, 0.15, 0.05],
    platePixelWidth: opts.platePixelWidth ?? 160,
  };
}

describe("areConfusable", () => {
  it("treats known look-alike glyphs as confusable", () => {
    expect(areConfusable("8", "B")).toBe(true);
    expect(areConfusable("0", "O")).toBe(true);
    expect(areConfusable("5", "S")).toBe(true);
  });

  it("does NOT treat visually distinct characters as confusable", () => {
    expect(areConfusable("A", "X")).toBe(false);
    expect(areConfusable("9", "4")).toBe(false);
  });
});

describe("normalizePlateText", () => {
  it("strips separators and casing without substituting anything", () => {
    expect(normalizePlateText("tn 09-ab 1234")).toBe("TN09AB1234");
  });

  it("preserves explicit unknown markers rather than dropping them", () => {
    expect(normalizePlateText("TN09A?1234")).toBe("TN09A?1234");
  });
});

describe("buildPlateConsensus — the no-hallucination guarantee", () => {
  it("confirms a plate when independent frames agree on every character", () => {
    const out = buildPlateConsensus({
      observations: [obs("TN09AB1234"), obs("TN09AB1234"), obs("TN09AB1234")],
    });
    expect(out.plate).toBe("TN09AB1234");
    expect(out.decision).toBe("CONFIRMED");
    expect(out.contributingFrames).toBe(3);
  });

  it("never confirms from a single frame, however confident that one read is", () => {
    const out = buildPlateConsensus({ observations: [obs("TN09AB1234", { charConf: 0.99, ocrConfidence: 0.99 })] });
    expect(out.decision).not.toBe("CONFIRMED");
    expect(out.decision).toBe("REVIEW_REQUIRED");
    expect(out.reasoning.some((r) => r.code === "SINGLE_FRAME_ONLY")).toBe(true);
  });

  it("leaves a confusable position UNKNOWN instead of resolving it by majority", () => {
    // 2 frames read B, 2 read 8 — a genuine 8/B ambiguity, not a settled answer.
    const out = buildPlateConsensus({
      observations: [obs("TN09AB1234"), obs("TN09AB1234"), obs("TN09A81234"), obs("TN09A81234")],
    });
    expect(out.plate).toBe(`TN09A${UNKNOWN_CHAR}1234`);
    expect(out.decision).toBe("PARTIALLY_READABLE");
    const ambiguous = out.characters[5];
    expect(ambiguous.character).toBe(UNKNOWN_CHAR);
    expect(ambiguous.confusableOnly).toBe(true);
  });

  it("escalates to CONFLICTING when frames disagree on a character that is NOT confusable", () => {
    // A vs X is not a plausible misread — this suggests two different plates.
    const out = buildPlateConsensus({
      observations: [obs("TN09AB1234"), obs("TN09AB1234"), obs("TN09XB1234")],
    });
    expect(out.decision).toBe("CONFLICTING");
    expect(out.reasoning.some((r) => r.code === "CHARACTER_CONFLICT")).toBe(true);
  });

  it("treats a differing plate length as a conflict rather than stretching one read onto another", () => {
    const out = buildPlateConsensus({
      observations: [obs("TN09AB1234"), obs("TN09AB1234"), obs("TN09AB123")],
    });
    expect(out.decision).toBe("CONFLICTING");
  });

  it("excludes crops below the pixel floor instead of upscaling and guessing", () => {
    const out = buildPlateConsensus({
      observations: [
        obs("TN09AB1234", { platePixelWidth: MIN_PLATE_PIXEL_WIDTH - 1 }),
        obs("TN09AB1234", { platePixelWidth: 20 }),
      ],
    });
    expect(out.decision).toBe("UNREADABLE");
    expect(out.plate).toBeNull();
    expect(out.reasoning.some((r) => r.code === "RESOLUTION_INSUFFICIENT")).toBe(true);
  });

  it("caps at REVIEW_REQUIRED when the vehicle track identity was not confirmed", () => {
    // Perfect character agreement, but we cannot prove it is the same vehicle.
    const out = buildPlateConsensus({
      observations: [obs("TN09AB1234"), obs("TN09AB1234"), obs("TN09AB1234")],
      identityUncertain: true,
    });
    expect(out.decision).toBe("REVIEW_REQUIRED");
    expect(out.reasoning.some((r) => r.code === "IDENTITY_UNCERTAIN")).toBe(true);
  });

  it("returns UNREADABLE, never an empty-looking guess, when there is nothing to read", () => {
    const out = buildPlateConsensus({ observations: [] });
    expect(out.decision).toBe("UNREADABLE");
    expect(out.plate).toBeNull();
    expect(out.characters).toEqual([]);
  });

  it("ignores explicit non-reads at a position rather than letting them vote", () => {
    const out = buildPlateConsensus({
      observations: [obs("TN09AB1234"), obs("TN09AB1234"), obs(`TN09A${UNKNOWN_CHAR}1234`)],
    });
    // The '?' contributes nothing; the two real reads still establish B.
    expect(out.plate).toBe("TN09AB1234");
    expect(out.decision).toBe("CONFIRMED");
  });

  it("CRITICAL: never emits a character that appeared in no source reading", () => {
    const inputs = ["TN09AB1234", "TN09A81234", "TN09AB1234"];
    const out = buildPlateConsensus({ observations: inputs.map((t) => obs(t)) });
    const seenPerPosition = inputs.map((t) => t.split(""));
    out.characters.forEach((c, i) => {
      if (c.character === UNKNOWN_CHAR) return;
      const observedHere = seenPerPosition.map((chars) => chars[i]);
      expect(observedHere).toContain(c.character);
    });
  });

  it("does not let a confident read off a terrible frame outvote agreeing good frames", () => {
    // Adequate resolution deliberately, so this exercises the QUALITY guard
    // rather than being filtered out earlier by the resolution gate.
    const awful: FrameQualityScores = { sharpness: 0.05, motionBlur: 0.05, exposure: 0.2, contrast: 0.1, glare: 0.2, overall: 8 };
    const out = buildPlateConsensus({
      observations: [
        obs("TN09AB1234"),
        obs("TN09AB1234"),
        obs("TN09AB1299", { charConf: 0.99, ocrConfidence: 0.99, quality: awful, platePixelWidth: 200 }),
      ],
    });
    // The bad frame disagrees on non-confusable digits, so this must surface as
    // a conflict — it must NOT quietly win on raw OCR confidence.
    expect(out.decision).toBe("CONFLICTING");
    expect(out.characters[8].character).not.toBe("9");
  });

  it("REGRESSION: refuses a low-resolution crop that silently truncates the plate", () => {
    // Found by running real OCR against a 75px-wide plate crop: it returned a
    // NINE-character plate at 95% confidence, having silently dropped a
    // character. A confidently-reported truncated plate is precisely the
    // false-identification failure this system exists to prevent, so the
    // resolution gate must exclude crops like this outright.
    const truncated = "TN09AB123"; // one character short of the real plate
    const out = buildPlateConsensus({
      observations: [obs(truncated, { platePixelWidth: 75 }), obs(truncated, { platePixelWidth: 75 })],
    });
    expect(out.decision).toBe("UNREADABLE");
    expect(out.plate).toBeNull();
  });

  it("REGRESSION: a truncated low-res read mixed with full-res reads is a conflict, not a silent pick", () => {
    const out = buildPlateConsensus({
      observations: [obs("TN09AB1234"), obs("TN09AB1234"), obs("TN09AB123")],
    });
    expect(out.decision).toBe("CONFLICTING");
  });

  it("degrades to UNREADABLE when too little of the plate is established", () => {
    // Every position is a 50/50 confusable split — almost nothing is settled.
    const out = buildPlateConsensus({
      observations: [obs("0O5S8B"), obs("O0S5B8"), obs("0O5S8B"), obs("O0S5B8")],
    });
    expect(["UNREADABLE", "PARTIALLY_READABLE"]).toContain(out.decision);
    if (out.plate) {
      expect(out.plate.split("").filter((c) => c !== UNKNOWN_CHAR).length).toBeLessThan(6);
    }
  });
});
