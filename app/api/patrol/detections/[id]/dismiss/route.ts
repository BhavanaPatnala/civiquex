import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, fail, withApiHandler } from "@/lib/api/respond";

export const POST = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireSession();

  const detection = await prisma.patrolDetection.findUnique({ where: { id: params.id } });
  if (!detection) return fail("Patrol detection not found", 404);
  if (detection.status !== "candidate") return fail(`Already ${detection.status}`, 409);

  await prisma.patrolDetection.update({ where: { id: detection.id }, data: { status: "dismissed" } });
  return ok({ dismissed: true });
});
