import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { fail, ok, withApiHandler } from "@/lib/api/respond";
import { ALLOWED_MEDIA_TYPES } from "@/lib/mediaTypes";

// Cheap capability probe the client checks once before deciding whether to
// upload directly to Blob or fall back to the base64-JSON path (local dev,
// which has no Vercel serverless-function body-size ceiling to worry about).
export const GET = withApiHandler(async () => ok({ configured: !!process.env.BLOB_READ_WRITE_TOKEN }));

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB — generous for a short evidence video

// Authorizes a direct browser-to-Blob upload for large evidence media (video
// in particular routinely exceeds Vercel's ~4.5MB request-body limit for
// serverless functions — routing the bytes through our own API, even as
// base64, hits that ceiling). The @vercel/blob/client `upload()` helper
// calls this route first to get a short-lived, scoped token, then uploads
// directly to Blob storage — the file's bytes never pass through this
// function at all. Requires a signed-in session, same as every other write
// path in this app.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return fail("Blob storage is not configured for this deployment", 501);
  }

  try {
    const session = await requireSession();

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_MEDIA_TYPES,
        addRandomSuffix: false,
        allowOverwrite: true, // filenames are content hashes — re-uploading identical bytes is a legitimate no-op
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        tokenPayload: JSON.stringify({ userId: session.id }),
      }),
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not authorize upload", 401);
  }
}
