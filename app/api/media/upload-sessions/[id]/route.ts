import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ok, fail, withApiHandler } from "@/lib/api/respond";

// Vercel Blob has no abort-multipart API, so cancelling here only stops us
// from tracking/resuming the session — any already-uploaded parts are
// orphaned under an uploadId nothing will ever complete, and age out on
// Blob's side unreferenced. That's a known, accepted gap (see the Phase A
// plan), not something fixable from this route.
export const DELETE = withApiHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const session = await requireSession();

  const uploadSession = await prisma.uploadSession.findUnique({ where: { id: params.id } });
  if (!uploadSession || uploadSession.userId !== session.id) return fail("Upload session not found", 404);

  await prisma.uploadSession.update({ where: { id: uploadSession.id }, data: { status: "CANCELLED" } });
  return ok({ status: "cancelled" });
});
