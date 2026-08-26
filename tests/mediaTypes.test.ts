import { describe, expect, it } from "vitest";
import { ALLOWED_MEDIA_TYPES, EXT_BY_MIME, MIME_BY_EXT, normalizeMimeType } from "@/lib/mediaTypes";

describe("normalizeMimeType", () => {
  it("strips codec parameters a browser may append", () => {
    expect(normalizeMimeType("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(normalizeMimeType("video/mp4; codecs=avc1.42E01E")).toBe("video/mp4");
  });

  it("leaves a bare MIME type unchanged (aside from casing/whitespace)", () => {
    expect(normalizeMimeType("image/jpeg")).toBe("image/jpeg");
    expect(normalizeMimeType(" IMAGE/JPEG ")).toBe("image/jpeg");
  });
});

describe("ALLOWED_MEDIA_TYPES / EXT_BY_MIME", () => {
  it("accepts common real-world mobile video formats, not just webm/mp4", () => {
    // The regression this covers: an iPhone's default video export
    // (video/quicktime, .mov) being silently rejected by a narrower
    // allowlist even though the file picker itself invites any video/*.
    expect(ALLOWED_MEDIA_TYPES).toContain("video/quicktime");
  });

  it("every allowed type has a corresponding extension, and MIME_BY_EXT round-trips it", () => {
    for (const mime of ALLOWED_MEDIA_TYPES) {
      const ext = EXT_BY_MIME[mime];
      expect(ext).toBeTruthy();
      expect(MIME_BY_EXT[ext]).toBe(mime);
    }
  });
});
