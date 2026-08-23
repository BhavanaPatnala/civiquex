import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, withApiHandler } from "@/lib/api/respond";

export const GET = withApiHandler(async () => {
  const session = await requireSession();
  const notifications = await prisma.notification.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return ok(notifications);
});

const patchSchema = z.object({ id: z.string(), read: z.boolean() });

export const PATCH = withApiHandler(async (req: Request) => {
  const session = await requireSession();
  const body = patchSchema.parse(await req.json());
  await prisma.notification.updateMany({ where: { id: body.id, userId: session.id }, data: { read: body.read } });
  return ok({ updated: true });
});
