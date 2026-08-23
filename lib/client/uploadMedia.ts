"use client";

import { upload } from "@vercel/blob/client";
import { blobToBase64 } from "@/lib/client/api";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/webm": "webm",
  "video/mp4": "mp4",
};

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Checked once per page load, not per upload — Blob's configured-ness
// doesn't change mid-session.
let blobConfigured: boolean | null = null;
async function isBlobConfigured(): Promise<boolean> {
  if (blobConfigured !== null) return blobConfigured;
  try {
    const res = await fetch("/api/media/upload-token");
    const body = await res.json();
    blobConfigured = res.ok && body?.data?.configured === true;
  } catch {
    blobConfigured = false;
  }
  return blobConfigured;
}

export interface PreparedMedia {
  mediaContentHash: string;
  /** Set when uploaded directly to Blob from the browser. */
  mediaBlobUrl?: string;
  /** Set when Blob isn't configured (local dev) — the existing small-payload path. */
  mediaBase64?: string;
}

/**
 * Prepares captured media for submission the way it actually needs to go.
 * Video routinely exceeds Vercel's ~4.5MB serverless-function request-body
 * limit, so on any deployment with Blob storage configured, the file
 * uploads directly from the browser to Blob — its bytes never pass through
 * our own API route at all, only a small JSON payload (a URL + hash) does
 * afterward. Falls back to the original base64-JSON path only when Blob
 * genuinely isn't configured (local dev has no such request-size ceiling).
 */
export async function prepareMediaForUpload(blob: Blob, mimeType: string): Promise<PreparedMedia> {
  const mediaContentHash = await sha256Hex(blob);

  if (await isBlobConfigured()) {
    const ext = EXT_BY_MIME[mimeType] ?? "bin";
    const result = await upload(`uploads/${mediaContentHash}.${ext}`, blob, {
      access: "private",
      contentType: mimeType,
      handleUploadUrl: "/api/media/upload-token",
    });
    return { mediaContentHash, mediaBlobUrl: result.url };
  }

  const mediaBase64 = await blobToBase64(blob);
  return { mediaContentHash, mediaBase64 };
}
