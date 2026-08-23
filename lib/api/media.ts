import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { head, put } from "@vercel/blob";

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
    // Private access: the blob's own URL is not fetchable by anyone who has
    // it, only via an authenticated read (see the "private" branch in
    // app/api/media/[filename]/route.ts) — matching this app's actual
    // access model (evidence is session-gated, never a bare public link).
    // Filenames are content hashes: identical bytes always produce the same
    // path, so a second upload of the same content is a legitimate no-op,
    // not an error — allowOverwrite makes that behave the same way the
    // local-disk branch already does (fs.writeFile silently replaces).
    const blob = await put(`uploads/${filename}`, bytes, {
      access: "private",
      contentType: mimeType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    blobUrl = blob.url;
  } else if (process.env.VERCEL) {
    // Running on Vercel with no Blob token configured: local disk would fail
    // with a confusing EROFS error deep in fs.writeFile. Fail loudly here
    // instead, with a message that says exactly what's missing.
    throw new Error(
      "Media storage isn't configured for this deployment: BLOB_READ_WRITE_TOKEN is missing. Connect a Blob store to this Vercel project (Storage tab) and redeploy."
    );
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

/**
 * Records evidence media the browser already uploaded directly to Blob (see
 * lib/client/uploadMedia.ts) — the path large captures (video especially)
 * must take, since routing their bytes through this app's own API route,
 * even as base64, hits Vercel's ~4.5MB serverless request-body limit. No
 * bytes pass through this function. It only reads the blob's real metadata
 * back from Vercel Blob (server-authoritative, unlike anything the client
 * claims) and checks its pathname matches the expected content-hash path —
 * a client can only have produced that pathname by successfully uploading
 * through our own token-gated /api/media/upload-token route in the first
 * place, so this rejects a client just naming an arbitrary URL.
 */
export async function recordDirectUpload(blobUrl: string, expectedHash: string): Promise<SavedMedia> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Media storage isn't configured for this deployment: BLOB_READ_WRITE_TOKEN is missing.");
  }

  const meta = await head(blobUrl);
  const ext = EXT_BY_MIME[meta.contentType];
  if (!ext) throw new Error(`Unsupported media type: ${meta.contentType}`);

  const filename = `${expectedHash}.${ext}`;
  if (!meta.pathname.endsWith(`uploads/${filename}`)) {
    throw new Error("Uploaded media does not match the expected content hash");
  }

  return {
    hash: expectedHash,
    filename,
    storageRef: `/api/media/${filename}`,
    blobUrl: meta.url,
    kind: meta.contentType.startsWith("video") ? "video" : "image",
    bytes: meta.size,
  };
}
