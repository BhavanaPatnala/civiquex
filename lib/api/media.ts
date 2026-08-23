import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";

// Route Handlers here accept media as base64-encoded JSON rather than
// multipart/form-data. Next.js 14.2's Route Handler `request.formData()`
// throws "Failed to parse body as FormData" on this Node/Windows/dev-server
// combination even for a bare-bones handler with no custom logic — a
// framework-level parser bug, not something fixable from application code.
// JSON body parsing has none of that fragility, at the cost of ~33% larger
// payloads, which is an acceptable trade for single-photo captures.
//
// Storage backend is chosen at runtime, not by environment: with
// BLOB_READ_WRITE_TOKEN set (Vercel Blob connected to the project), media
// uploads go to Blob — required on Vercel, whose filesystem is ephemeral in
// production. Without it, local disk under storage/uploads is used, so local
// development never needs a real Blob store. Either way, every caller in the
// app only ever sees the same app-facing "/api/media/<filename>" reference —
// see app/api/media/[filename]/route.ts, the single session-gated, audit-
// logged proxy every piece of evidence is served through.

const UPLOAD_DIR = path.join(process.cwd(), "storage", "uploads");
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/webm": "webm",
  "video/mp4": "mp4",
};

export interface SavedMedia {
  hash: string;
  filename: string;
  storageRef: string;
  blobUrl: string | null;
  kind: "video" | "image";
  bytes: number;
}

/** Decodes a base64 data payload, writes it to the upload store (Vercel Blob or local disk), and returns its reference. Throws on an unsupported MIME type. */
export async function saveBase64Media(base64: string, mimeType: string, maxBytes: number): Promise<SavedMedia> {
  const ext = EXT_BY_MIME[mimeType];
  if (!ext) throw new Error(`Unsupported media type: ${mimeType}`);

  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) throw new Error("Media payload is empty");
  if (bytes.length > maxBytes) throw new Error(`Media exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit`);

  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const filename = `${hash}.${ext}`;

  let blobUrl: string | null = null;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`uploads/${filename}`, bytes, { access: "public", contentType: mimeType, addRandomSuffix: false });
    blobUrl = blob.url;
  } else {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR, filename), bytes);
  }

  return {
    hash,
    filename,
    storageRef: `/api/media/${filename}`,
    blobUrl,
    kind: mimeType.startsWith("video") ? "video" : "image",
    bytes: bytes.length,
  };
}
