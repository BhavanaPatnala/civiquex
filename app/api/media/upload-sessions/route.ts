import { z } from "zod";
import { BlobNotFoundError, createMultipartUpload, head } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ok, fail, withApiHandler } from "@/lib/api/respond";

// Large-media resumable upload — the browser splits a file into parts and
// uploads them directly to Vercel Blob (bytes never pass through our own API
// route), so a dropped connection only costs the current part, not the
// whole file. See lib/client/uploadMedia.ts's uploadLargeMedia() for the
// client side of this flow.
//
// We are the only source of truth for "what parts have already arrived" —
// Blob's SDK has no "list uploaded parts" API — so every part completion is
// recorded here (see [id]/parts/route.ts) before the browser can safely skip
// re-uploading it on a resumed session.

const PART_SIZE_BYTES = 8 * 1024 * 1024; // 8MB — Blob requires >=5MB per part except the last
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB — generous ceiling for a real dashcam-length clip
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "video/webm", "video/mp4"];
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/webm": "webm",
  "video/mp4": "mp4",
};
const CLIENT_TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // 6h — generous enough to survive a paused/resumed large upload

const bodySchema = z.object({
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  mimeType: z.enum(ALLOWED_TYPES as [string, ...string[]]),
  totalBytes: z.coerce.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export const POST = withApiHandler(async (request: Request) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return fail("Media storage isn't configured for this deployment: BLOB_READ_WRITE_TOKEN is missing.", 501);
  }

  const session = await requireSession();
  const body = bodySchema.parse(await request.json());
  const ext = EXT_BY_MIME[body.mimeType];
  const blobPathname = `uploads/${body.contentHash}.${ext}`;

  // Blob itself is the authoritative source for "does this content already
  // exist" — a Postgres lookup could drift (a row without a blob, or vice
  // versa). If it's already there, skip creating a session entirely.
  try {
    const existing = await head(blobPathname);
    return ok({ status: "already-uploaded" as const, mediaBlobUrl: existing.url, mediaContentHash: body.contentHash });
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) throw err;
  }

  const existingSession = await prisma.uploadSession.findUnique({
    where: { userId_contentHash: { userId: session.id, contentHash: body.contentHash } },
  });

  if (existingSession?.status === "COMPLETE" && existingSession.blobUrl) {
    return ok({ status: "already-uploaded" as const, mediaBlobUrl: existingSession.blobUrl, mediaContentHash: body.contentHash });
  }

  // A client token is scoped by pathname, not by a specific multipart
  // upload — the same token works for every uploadPart call regardless of
  // uploadId/key, so this only needs the pathname in scope. Both create and
  // complete happen server-side (this route + .../complete), so the client
  // only ever needs a token scoped to uploadPart itself.
  const mintClientToken = () =>
    generateClientTokenFromReadWriteToken({
      pathname: blobPathname,
      allowedContentTypes: [body.mimeType],
      maximumSizeInBytes: body.totalBytes,
      validUntil: Date.now() + CLIENT_TOKEN_TTL_MS,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

  // Resume: an IN_PROGRESS session already exists for this exact content —
  // re-mint a fresh client token (the old one may have expired) and hand
  // back what's already been recorded so the browser can skip those parts.
  if (existingSession?.status === "IN_PROGRESS") {
    const token = await mintClientToken();
    return ok({
      status: "resumed" as const,
      sessionId: existingSession.id,
      clientToken: token,
      pathname: existingSession.blobPathname,
      uploadId: existingSession.multipartUploadId,
      key: existingSession.multipartKey,
      partSizeBytes: existingSession.partSizeBytes,
      completedParts: JSON.parse(existingSession.completedPartsJson) as { partNumber: number; etag: string }[],
    });
  }

  // Fresh start: either no session exists yet, or the previous one was
  // cancelled/failed. A cancelled session's multipart upload is abandoned
  // (Blob has no abort API — the orphaned parts just age out unreferenced);
  // we always begin a brand new multipart upload here.
  const { key, uploadId } = await createMultipartUpload(blobPathname, {
    access: "private",
    contentType: body.mimeType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  const sessionRow = await prisma.uploadSession.upsert({
    where: { userId_contentHash: { userId: session.id, contentHash: body.contentHash } },
    create: {
      userId: session.id,
      contentHash: body.contentHash,
      mimeType: body.mimeType,
      totalBytes: BigInt(body.totalBytes),
      blobPathname,
      multipartUploadId: uploadId,
      multipartKey: key,
      partSizeBytes: PART_SIZE_BYTES,
      status: "IN_PROGRESS",
    },
    update: {
      totalBytes: BigInt(body.totalBytes),
      multipartUploadId: uploadId,
      multipartKey: key,
      partSizeBytes: PART_SIZE_BYTES,
      completedPartsJson: "[]",
      status: "IN_PROGRESS",
      blobUrl: null,
    },
  });

  const token = await mintClientToken();
  return ok(
    {
      status: "created" as const,
      sessionId: sessionRow.id,
      clientToken: token,
      pathname: blobPathname,
      uploadId,
      key,
      partSizeBytes: PART_SIZE_BYTES,
      completedParts: [] as { partNumber: number; etag: string }[],
    },
    201
  );
});
