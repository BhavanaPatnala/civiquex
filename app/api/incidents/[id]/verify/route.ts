// Authority-facing response endpoint: acknowledge, redirect, report action
// taken, or close. Every outcome is logged into the auditable routing
// feedback table so the Authority Resolution Engine can learn from it (see
// lib/services/authorityService.ts and lib/engines/authority.ts).
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, fail, withApiHandler } from "@/lib/api/respond";
import { recordRoutingFeedback } from "@/lib/services/authorityService";
import { eventBus } from "@/lib/realtime/bus";

const schema = z.object({
  eventType: z.enum(["acknowledged", "redirected", "action_reported", "closed"]),
  note: z.string().max(2000).optional(),
  redirectedToId: z.string().optional(),
});

const STATUS_FOR_EVENT: Record<string, string> = {
  acknowledged: "AUTHORITY_ACKNOWLEDGED",
  action_reported: "ACTION_REPORTED",
  closed: "ACTION_REPORTED",
  redirected: "SUBMITTED",
};

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireRole("AUTHORITY", "ADMIN");
  const body = schema.parse(await req.json());

  const incident = await prisma.incident.findFirst({
    where: { OR: [{ id: params.id }, { publicId: params.id }] },
    include: { submissions: true },
  });
  if (!incident) return fail("Incident not found", 404);

  const submission = incident.submissions[0];
  if (!submission) return fail("Incident has not been submitted to an authority yet", 422);

  if (body.eventType === "redirected" && !body.redirectedToId) {
    return fail("redirectedToId is required when redirecting a submission", 422);
  }

  await prisma.submissionEvent.create({
    data: {
      submissionId: submission.id,
      eventType: body.eventType,
      note: body.note,
      redirectedToId: body.eventType === "redirected" ? body.redirectedToId : null,
    },
  });

  await prisma.submission.update({
    where: { id: submission.id },
    data: { status: body.eventType === "closed" ? "closed" : body.eventType },
  });

  await recordRoutingFeedback({
    authorityId: submission.authorityId,
    outcome: body.eventType === "redirected" ? "redirected" : "accepted",
    redirectedToId: body.eventType === "redirected" ? body.redirectedToId : null,
    roadSegmentId: incident.roadSegmentId,
    incidentType: incident.incidentType,
  });

  const newAuthorityId = body.eventType === "redirected" ? body.redirectedToId! : incident.authorityId;

  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: { status: STATUS_FOR_EVENT[body.eventType], authorityId: newAuthorityId },
  });

  await prisma.auditLog.create({
    data: {
      actorId: session.id,
      action: `authority.${body.eventType}`,
      entityType: "incident",
      entityId: incident.id,
      incidentId: incident.id,
      metadataJson: JSON.stringify({ note: body.note, redirectedToId: body.redirectedToId }),
    },
  });

  eventBus.emit("incident.updated", { incidentId: incident.id, status: updated.status });

  return ok({ incidentId: incident.id, status: updated.status });
});
