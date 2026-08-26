import { completeMultipartUpload } from "@vercel/blob";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ok, fail, withApiHandler } from "@/lib/api/respond";

interface CompletedPart {
  partNumber: number;
  etag: string;
}

// Finalization happens entirely server-side, using OUR OWN recorded parts
// list as the authoritative source — the client never supplies the final
// parts array here, which closes off a route where a malicious client could
// otherwise claim a different (or truncated) set of parts than what it
// actually uploaded.
export const POST = withApiHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const session = await requireSession();

  const uploadSession = await prisma.uploadSession.findUnique({ where: { id: params.id } });
  if (!uploadSession || uploadSession.userId !== session.id) return fail("Upload session not found", 404);
  if (uploadSession.status === "COMPLETE" && uploadSession.blobUrl) {
    return ok({ mediaBlobUrl: uploadSession.blobUrl, mediaContentHash: uploadSession.contentHash });
  }
  if (uploadSession.status !== "IN_PROGRESS") return fail(`Upload session is ${uploadSession.status.toLowerCase()}, cannot complete`, 409);

  const parts: CompletedPart[] = JSON.parse(uploadSession.completedPartsJson);
  if (parts.length === 0) return fail("No parts have been uploaded for this session", 422);

  const result = await completeMultipartUpload(
    uploadSession.blobPathname,
    parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
    {
      access: "private",
      uploadId: uploadSession.multipartUploadId,
      key: uploadSession.multipartKey,
      contentType: uploadSession.mimeType,
    }
  );

  await prisma.uploadSession.update({
    where: { id: uploadSession.id },
    data: { status: "COMPLETE", blobUrl: result.url },
  });

  return ok({ mediaBlobUrl: result.url, mediaContentHash: uploadSession.contentHash });
});
