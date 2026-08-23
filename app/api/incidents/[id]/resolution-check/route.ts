import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, fail, withApiHandler } from "@/lib/api/respond";
import { runResolutionCheck } from "@/lib/services/resolutionService";

export const POST = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireSession();

  const incident = await prisma.incident.findFirst({ where: { OR: [{ id: params.id }, { publicId: params.id }] } });
  if (!incident) return fail("Incident not found", 404);

  const { check, result, newStatus } = await runResolutionCheck(incident.id);

  return ok({ check, result, status: newStatus });
});
