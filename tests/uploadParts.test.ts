import { describe, expect, it } from "vitest";
import { mergePart, partByteRange, remainingPartNumbers, totalPartsFor } from "@/lib/uploadParts";

describe("totalPartsFor", () => {
  it("computes the number of 8MB parts for a real video size", () => {
    const partSize = 8 * 1024 * 1024;
    expect(totalPartsFor(20 * 1024 * 1024, partSize)).toBe(3); // 20MB -> 8+8+4
    expect(totalPartsFor(1.5 * 1024 * 1024 * 1024, partSize)).toBe(192); // 1.5GB
  });

  it("always reports at least one part, even for a tiny file", () => {
    expect(totalPartsFor(100, 8 * 1024 * 1024)).toBe(1);
  });
});

describe("partByteRange", () => {
  const partSize = 8 * 1024 * 1024;

  it("returns full-size ranges for interior parts", () => {
    expect(partByteRange(1, partSize, 20 * 1024 * 1024)).toEqual({ start: 0, end: partSize });
    expect(partByteRange(2, partSize, 20 * 1024 * 1024)).toEqual({ start: partSize, end: partSize * 2 });
  });

  it("clamps the final part to the file's actual end", () => {
    const totalBytes = 20 * 1024 * 1024; // 3 parts: 8, 8, 4
    expect(partByteRange(3, partSize, totalBytes)).toEqual({ start: partSize * 2, end: totalBytes });
  });
});

describe("remainingPartNumbers", () => {
  it("lists every part when nothing has completed yet", () => {
    expect(remainingPartNumbers(4, [])).toEqual([1, 2, 3, 4]);
  });

  it("skips parts already recorded as complete, regardless of order", () => {
    expect(remainingPartNumbers(5, [{ partNumber: 3, etag: "a" }, { partNumber: 1, etag: "b" }])).toEqual([2, 4, 5]);
  });

  it("returns an empty list once every part is done — the signal to finalize", () => {
    const completed = [1, 2, 3].map((partNumber) => ({ partNumber, etag: `etag-${partNumber}` }));
    expect(remainingPartNumbers(3, completed)).toEqual([]);
  });
});

describe("mergePart", () => {
  it("appends a new part and keeps the list sorted by part number", () => {
    const result = mergePart([{ partNumber: 1, etag: "a" }], { partNumber: 3, etag: "c" });
    expect(result).toEqual([{ partNumber: 1, etag: "a" }, { partNumber: 3, etag: "c" }]);
  });

  it("replaces a stale record for the same part instead of duplicating it — a retried report of an already-recorded part", () => {
    const result = mergePart([{ partNumber: 2, etag: "old" }], { partNumber: 2, etag: "new" });
    expect(result).toEqual([{ partNumber: 2, etag: "new" }]);
  });

  it("inserts out of order but the result stays sorted", () => {
    const result = mergePart(
      [
        { partNumber: 1, etag: "a" },
        { partNumber: 3, etag: "c" },
      ],
      { partNumber: 2, etag: "b" }
    );
    expect(result.map((p) => p.partNumber)).toEqual([1, 2, 3]);
  });
});
