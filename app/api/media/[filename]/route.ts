import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { fail, withApiHandler } from "@/lib/api/respond";

const UPLOAD_DIR = path.join(process.cwd(), "storage", "uploads");

const CONTENT_TYPES: Record<string, string> = {
  webm: "video/webm",
  mp4: "video/mp4",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

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

  let data: Buffer;
  if (evidence?.blobUrl) {
    // Private-access blob (see lib/api/media.ts) — requires an authenticated
    // read via the SDK (BLOB_READ_WRITE_TOKEN), not a bare fetch(); the raw
    // URL alone is not fetchable by design, matching the app's real access
    // model where evidence is never a bare public link.
    const result = await get(evidence.blobUrl, { access: "private" });
    if (!result) return fail("Media not found", 404);
    data = Buffer.from(await new Response(result.stream).arrayBuffer());
  } else {
    const filePath = path.join(UPLOAD_DIR, filename);
    try {
      data = await fs.readFile(filePath);
    } catch {
      return fail("Media not found", 404);
    }
  }

  if (evidence) {
    await prisma.evidenceAccessLog.create({
      data: { evidenceId: evidence.id, actorId: session.id, action: "view" },
    });
  }

  const ext = filename.split(".").pop() ?? "";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
