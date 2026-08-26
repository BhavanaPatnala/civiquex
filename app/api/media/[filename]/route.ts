import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { fail, withApiHandler } from "@/lib/api/respond";
import { MIME_BY_EXT } from "@/lib/mediaTypes";

const UPLOAD_DIR = path.join(process.cwd(), "storage", "uploads");

// Evidence access is gated behind a session and every fetch is logged —
// evidence is kept separate from public content per the privacy-first
// evidence handling requirement. This is the ONLY route that ever serves
// evidence bytes: whether the underlying storage is Vercel Blob or local
// disk (see lib/api/media.ts), the app links to this URL, never the raw
// storage location, so the session check and access log apply either way.
export const GET = withApiHandler(async (req: Request, { params }: { params: { filename: string } }) => {
  const session = await getSession();
  if (!session) return fail("Authentication required to view evidence media", 401);

  const filename = params.filename;
  if (!/^[a-f0-9]{64}\.[a-z0-9]+$/i.test(filename)) return fail("Invalid media reference", 400);

  const evidence = await prisma.evidence.findFirst({ where: { storageRef: `/api/media/${filename}` } });

  // The access-log write only depends on `evidence`, same as the media
  // fetch below — they don't depend on each other, so running them
  // sequentially was pure added latency (another ~500ms Neon round trip
  // stacked on top of the blob fetch) for no reason. Concurrent instead.
  const mediaPromise: Promise<Buffer> = evidence?.blobUrl
    ? // Private-access blob (see lib/api/media.ts) — requires an
      // authenticated read via the SDK (BLOB_READ_WRITE_TOKEN), not a bare
      // fetch(); the raw URL alone is not fetchable by design, matching the
      // app's real access model where evidence is never a bare public link.
      get(evidence.blobUrl, { access: "private" }).then(async (result) => {
        if (!result) throw new Error("not-found");
        return Buffer.from(await new Response(result.stream).arrayBuffer());
      })
    : fs.readFile(path.join(UPLOAD_DIR, filename));

  const logPromise = evidence
    ? prisma.evidenceAccessLog.create({ data: { evidenceId: evidence.id, actorId: session.id, action: "view" } })
    : Promise.resolve(null);

  // Both requests are already in flight concurrently at this point. Awaited
  // separately (not Promise.all) so a genuine access-log failure — an
  // accountability nicety, not a precondition for serving evidence a
  // session has already been authorized to see — can never turn into a
  // false "media not found" for the caller.
  let data: Buffer;
  try {
    data = await mediaPromise;
  } catch {
    return fail("Media not found", 404);
  }
  await logPromise.catch((err) => console.error("[media] failed to record evidence access log", err));

  const ext = filename.split(".").pop() ?? "";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
