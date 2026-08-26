"use client";

import { upload, uploadPart } from "@vercel/blob/client";
import { apiDelete, apiPatch, apiPost, blobToBase64 } from "@/lib/client/api";
import { deletePendingBlob, getPendingBlob, putPendingBlob } from "@/lib/client/uploadStore";
import { partByteRange, remainingPartNumbers, totalPartsFor, type CompletedPart } from "@/lib/uploadParts";
import { EXT_BY_MIME, normalizeMimeType } from "@/lib/mediaTypes";

// Anything under this rides the simple single-shot direct-upload path
// (unchanged). Above it, resumability actually matters — a dropped
// connection on a multi-hundred-MB video shouldn't mean starting over.
const LARGE_FILE_THRESHOLD_BYTES = 4 * 1024 * 1024;
const RESUME_POINTER_KEY = "civiquex-upload-resume";

export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelledError";
  }
}

/** A safe, user-facing message for a known failure mode — unlike an arbitrary caught exception, callers should show `.message` directly rather than a generic fallback. */
export class MediaProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaProcessingError";
  }
}

async function sha256Hex(blob: Blob): Promise<string> {
  // crypto.subtle only exists in a secure context (HTTPS, or localhost) —
  // a plain-HTTP LAN address (e.g. testing on a phone against a dev
  // machine's local IP) silently has no crypto.subtle at all on real mobile
  // browsers, which previously threw an opaque TypeError here that surfaced
  // to the user as a generic "Processing failed" with no way to self-diagnose.
  if (!crypto.subtle) {
    throw new MediaProcessingError(
      "This connection isn't secure enough to process evidence (HTTPS is required). Open the site's regular link instead of a local network address."
    );
  }
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
  /** The normalized MIME type actually used for the upload — use this, not the original blob.type, in any follow-up request (e.g. /api/observations' mediaType field) so they can never disagree. */
  mediaType: string;
  /** Set when uploaded directly to Blob from the browser. */
  mediaBlobUrl?: string;
  /** Set when Blob isn't configured (local dev) — the existing small-payload path. */
  mediaBase64?: string;
}

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  /** Fires once the server has confirmed/created the session, so the caller can hold onto it for a live Cancel action. */
  onSessionReady?: (session: { sessionId: string; contentHash: string }) => void;
  /** Fires as soon as the content hash is computed, before any network call — lets a caller persist resume context under the same key without hashing the file a second time. */
  onHashReady?: (contentHash: string) => void;
  signal?: AbortSignal;
}

interface CreateOrResumeResponse {
  status: "already-uploaded" | "created" | "resumed";
  mediaBlobUrl?: string;
  mediaContentHash?: string;
  sessionId?: string;
  clientToken?: string;
  pathname?: string;
  uploadId?: string;
  key?: string;
  partSizeBytes?: number;
  completedParts?: CompletedPart[];
}

/** What's left of an interrupted large upload, if this browser still has the bytes for it. */
export interface ResumableUpload {
  sessionId: string;
  contentHash: string;
  mimeType: string;
  fractionComplete: number;
}

function readResumePointer(): { contentHash: string; mimeType: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(RESUME_POINTER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeResumePointer(contentHash: string, mimeType: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RESUME_POINTER_KEY, JSON.stringify({ contentHash, mimeType }));
}

function clearResumePointer() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(RESUME_POINTER_KEY);
}

/**
 * Checks whether a previous session left an interrupted large upload behind
 * — the raw bytes are still in IndexedDB (see lib/client/uploadStore.ts) and
 * the server still has an IN_PROGRESS session for the same content hash.
 * Returns null if there's nothing to resume (nothing pending, the pending
 * blob aged out of IndexedDB, or the server-side session was cancelled).
 */
export async function checkForResumableUpload(): Promise<ResumableUpload | null> {
  const pointer = readResumePointer();
  if (!pointer) return null;

  const pendingBlob = await getPendingBlob(pointer.contentHash);
  if (!pendingBlob) {
    clearResumePointer();
    return null;
  }

  try {
    const res = await apiPost<CreateOrResumeResponse>("/api/media/upload-sessions", {
      contentHash: pointer.contentHash,
      mimeType: pointer.mimeType,
      totalBytes: pendingBlob.size,
    });
    if (res.status !== "resumed" || !res.partSizeBytes || !res.sessionId) {
      clearResumePointer();
      await deletePendingBlob(pointer.contentHash);
      return null;
    }
    const totalParts = totalPartsFor(pendingBlob.size, res.partSizeBytes);
    const fractionComplete = (res.completedParts?.length ?? 0) / totalParts;
    return { sessionId: res.sessionId, contentHash: pointer.contentHash, mimeType: pointer.mimeType, fractionComplete };
  } catch {
    clearResumePointer();
    return null;
  }
}

/**
 * Cancels an upload session — either one actively running in this tab (the
 * caller holds `sessionId` from `onSessionReady`) or a stale one found by
 * `checkForResumableUpload`. Best-effort: Blob has no abort-multipart API,
 * so this only stops us from tracking/resuming it — already-uploaded parts
 * age out unreferenced on Blob's side, a known accepted gap.
 */
export async function cancelUploadSession(sessionId: string, contentHash: string): Promise<void> {
  try {
    await apiDelete(`/api/media/upload-sessions/${sessionId}`);
  } finally {
    clearResumePointer();
    await deletePendingBlob(contentHash);
  }
}

async function uploadLargeMedia(blob: Blob, mimeType: string, contentHash: string, opts?: UploadOptions): Promise<string> {
  // Durable before any network call — this is what makes "resume after
  // reopening the app" physically possible; a Blob object alone doesn't
  // survive a reload.
  await putPendingBlob(contentHash, blob);
  writeResumePointer(contentHash, mimeType);

  const created = await apiPost<CreateOrResumeResponse>("/api/media/upload-sessions", {
    contentHash,
    mimeType,
    totalBytes: blob.size,
  });

  if (created.status === "already-uploaded" && created.mediaBlobUrl) {
    clearResumePointer();
    await deletePendingBlob(contentHash);
    opts?.onProgress?.(1);
    return created.mediaBlobUrl;
  }

  const { sessionId, clientToken, pathname, uploadId, key, partSizeBytes, completedParts } = created;
  if (!sessionId || !clientToken || !pathname || !uploadId || !key || !partSizeBytes) {
    throw new Error("Upload session response was incomplete");
  }
  opts?.onSessionReady?.({ sessionId, contentHash });

  const already: CompletedPart[] = completedParts ?? [];
  const totalParts = totalPartsFor(blob.size, partSizeBytes);
  let doneCount = already.length;
  opts?.onProgress?.(doneCount / totalParts);

  for (const partNumber of remainingPartNumbers(totalParts, already)) {
    if (opts?.signal?.aborted) throw new UploadCancelledError();

    const { start, end } = partByteRange(partNumber, partSizeBytes, blob.size);
    const chunk = blob.slice(start, end);

    const part = await uploadPart(pathname, chunk, {
      access: "private",
      token: clientToken,
      uploadId,
      key,
      partNumber,
      contentType: mimeType,
      abortSignal: opts?.signal,
    });

    await apiPatch(`/api/media/upload-sessions/${sessionId}/parts`, { partNumber, etag: part.etag });
    doneCount++;
    opts?.onProgress?.(doneCount / totalParts);
  }

  const completed = await apiPost<{ mediaBlobUrl: string; mediaContentHash: string }>(`/api/media/upload-sessions/${sessionId}/complete`);
  clearResumePointer();
  await deletePendingBlob(contentHash);
  return completed.mediaBlobUrl;
}

/**
 * Prepares captured media for submission the way it actually needs to go.
 * Small captures ride along as base64 JSON or a single direct-to-Blob PUT.
 * Anything larger (video, in particular — it routinely exceeds Vercel's
 * ~4.5MB serverless-function request-body limit even before considering
 * multi-hundred-MB files) uploads in resumable parts instead, so a dropped
 * connection only costs the current part, not the whole file. Falls back to
 * the base64-JSON path only when Blob genuinely isn't configured (local dev
 * has no such request-size ceiling).
 */
export async function prepareMediaForUpload(blob: Blob, rawMimeType: string, opts?: UploadOptions): Promise<PreparedMedia> {
  // A recorded/selected file's reported type can carry codec parameters
  // (e.g. "video/webm;codecs=vp9,opus") that would otherwise fail an exact
  // match against the server's allowlist — normalize once, here, and use
  // this value everywhere downstream (including what's sent to the server).
  const mimeType = normalizeMimeType(rawMimeType);
  const mediaContentHash = await sha256Hex(blob);
  opts?.onHashReady?.(mediaContentHash);

  if (await isBlobConfigured()) {
    if (blob.size > LARGE_FILE_THRESHOLD_BYTES) {
      const mediaBlobUrl = await uploadLargeMedia(blob, mimeType, mediaContentHash, opts);
      return { mediaContentHash, mediaType: mimeType, mediaBlobUrl };
    }

    const ext = EXT_BY_MIME[mimeType] ?? "bin";
    const result = await upload(`uploads/${mediaContentHash}.${ext}`, blob, {
      access: "private",
      contentType: mimeType,
      handleUploadUrl: "/api/media/upload-token",
      abortSignal: opts?.signal,
    });
    opts?.onProgress?.(1);
    return { mediaContentHash, mediaType: mimeType, mediaBlobUrl: result.url };
  }

  const mediaBase64 = await blobToBase64(blob);
  opts?.onProgress?.(1);
  return { mediaContentHash, mediaType: mimeType, mediaBase64 };
}
