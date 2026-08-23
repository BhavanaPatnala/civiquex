import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, fail, withApiHandler } from "@/lib/api/respond";
import { eventBus } from "@/lib/realtime/bus";
import { formatSubmissionReference } from "@/lib/ids";

export const POST = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireSession();

  const incident = await prisma.incident.findFirst({
    where: { OR: [{ id: params.id }, { publicId: params.id }] },
    include: { authority: true },
  });
  if (!incident) return fail("Incident not found", 404);
  if (!incident.authority) {
    return fail("External submission unavailable — no authority is registered for this incident's location and type.", 422);
  }
  if (incident.authority.submissionMethod === "unavailable") {
    return fail(`External submission unavailable — ${incident.authority.name} has no configured submission channel in this build.`, 422);
  }

  const existing = await prisma.submission.findFirst({ where: { incidentId: incident.id } });
  if (existing) return fail("This incident has already been submitted", 409);

  const authorityCode = incident.authority.name
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 4);
  const seq = (await prisma.submission.count({ where: { authorityId: incident.authorityId! } })) + 1;

  const submission = await prisma.submission.create({
    data: {
      incidentId: incident.id,
      authorityId: incident.authorityId!,
      channel: incident.authority.submissionMethod,
      referenceNumber: formatSubmissionReference(authorityCode, seq),
      status: "pending",
    },
  });

  await prisma.incident.update({ where: { id: incident.id }, data: { status: "SUBMITTED" } });

  await prisma.auditLog.create({
    data: {
      action: "incident.submitted",
      entityType: "incident",
      entityId: incident.id,
      incidentId: incident.id,
      metadataJson: JSON.stringify({ submissionId: submission.id, channel: submission.channel }),
    },
  });

  eventBus.emit("incident.updated", { incidentId: incident.id, status: "SUBMITTED" });

  return ok(submission, 201);
});
