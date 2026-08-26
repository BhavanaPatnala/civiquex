import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ok, fail, withApiHandler } from "@/lib/api/respond";
import { mergePart, type CompletedPart } from "@/lib/uploadParts";

const bodySchema = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string().min(1),
});

export const PATCH = withApiHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const session = await requireSession();
  const body = bodySchema.parse(await request.json());

  const uploadSession = await prisma.uploadSession.findUnique({ where: { id: params.id } });
  if (!uploadSession || uploadSession.userId !== session.id) return fail("Upload session not found", 404);
  if (uploadSession.status !== "IN_PROGRESS") return fail(`Upload session is ${uploadSession.status.toLowerCase()}, not accepting parts`, 409);

  const completedParts: CompletedPart[] = JSON.parse(uploadSession.completedPartsJson);
  const updatedParts = mergePart(completedParts, { partNumber: body.partNumber, etag: body.etag });

  await prisma.uploadSession.update({
    where: { id: uploadSession.id },
    data: { completedPartsJson: JSON.stringify(updatedParts) },
  });

  return ok({ completedParts: updatedParts });
});
