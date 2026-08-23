import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ok, fail, withApiHandler } from "@/lib/api/respond";

export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const incident = await prisma.incident.findFirst({
    where: { OR: [{ id: params.id }, { publicId: params.id }] },
    include: {
      location: true,
      roadSegment: true,
      authority: true,
      hotspot: true,
      observations: {
        orderBy: { addedAt: "asc" },
        include: { observation: { include: { media: true, vehicle: true } } },
      },
      submissions: { include: { events: { orderBy: { occurredAt: "asc" } } } },
      resolutionChecks: { orderBy: { checkedAt: "asc" } },
      riskScores: { orderBy: { computedAt: "asc" } },
      auditLogs: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!incident) return fail("Incident not found", 404);

  // Access control: a citizen may only open an incident built from their
  // own submission(s) — never the wider repository, whatever id they try.
  // Authority/admin can open anything. Not-found (not "forbidden") either
  // way, so a citizen probing ids can't distinguish "not yours" from
  // "doesn't exist."
  const session = await getSession();
  const isAuthorityOrAdmin = session?.role === "AUTHORITY" || session?.role === "ADMIN";
  if (!isAuthorityOrAdmin) {
    const owns = session ? incident.observations.some((link) => link.observation.userId === session.id) : false;
    if (!owns) return fail("Incident not found", 404);
  }

  // The rule engine's own context checks (see lib/engines/rules.ts) are
  // logged verbatim on the "incident.created" audit event — surface them as
  // a clean field so the UI can render "why was this verified" without
  // reaching into audit-log internals. Visible to the owner, not just staff:
  // it's the reasoning behind their own submission's outcome.
  const createdLog = incident.auditLogs.find((a) => a.action === "incident.created");
  const contextChecks: { label: string; passed: boolean; detail: string }[] = createdLog?.metadataJson
    ? (JSON.parse(createdLog.metadataJson)?.ruleResult?.contextChecks ?? [])
    : [];

  return ok({
    id: incident.id,
    publicId: incident.publicId,
    incidentType: incident.incidentType,
    status: incident.status,
    riskLevel: incident.riskLevel,
    evidenceConfidenceOverall: incident.evidenceConfidenceOverall,
    evidenceConfidenceBreakdown: JSON.parse(incident.evidenceConfidenceBreakdown),
    ruleVerdict: incident.ruleVerdict,
    ruleReasoning: incident.ruleReasoning,
    contextChecks,
    recurring: incident.recurring,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    location: incident.location,
    roadSegment: incident.roadSegment,
    authority: incident.authority,
    hotspot: incident.hotspot,
    observations: incident.observations.map((link) => ({
      linkId: link.id,
      correlationScore: link.correlationScore,
      correlationFactors: JSON.parse(link.correlationFactorsJson),
      addedAt: link.addedAt,
      observation: {
        id: link.observation.id,
        sourceType: link.observation.sourceType,
        observerHash: link.observation.observerHash,
        capturedAt: link.observation.capturedAt,
        lat: link.observation.lat,
        lng: link.observation.lng,
        orientationDeg: link.observation.orientationDeg,
        detections: JSON.parse(link.observation.objectDetectionsJson),
        visionModel: link.observation.visionModel,
        visionModelVersion: link.observation.visionModelVersion,
        media: link.observation.media
          ? {
              id: link.observation.media.id,
              kind: link.observation.media.kind,
              url: link.observation.media.storageRef,
              facesBlurred: link.observation.media.facesBlurred,
              encrypted: link.observation.media.encrypted,
              retentionUntil: link.observation.media.retentionUntil,
            }
          : null,
        vehicleFingerprint: link.observation.vehicle?.fingerprintHash ?? null,
        vehicle: link.observation.vehicle
          ? { typeClass: link.observation.vehicle.typeClass, colorClass: link.observation.vehicle.colorClass }
          : null,
      },
    })),
    submissions: incident.submissions.map((s) => ({
      id: s.id,
      authorityId: s.authorityId,
      channel: s.channel,
      referenceNumber: s.referenceNumber,
      status: s.status,
      submittedAt: s.submittedAt,
      events: s.events,
    })),
    resolutionChecks: incident.resolutionChecks.map((c) => ({
      id: c.id,
      checkedAt: c.checkedAt,
      result: c.result,
      confidence: c.confidence,
      similarityScore: c.similarityScore,
      objectPresenceDelta: JSON.parse(c.objectPresenceDeltaJson),
    })),
    riskScoreHistory: incident.riskScores.map((r) => ({
      computedAt: r.computedAt,
      score: r.score,
      level: r.level,
      factors: JSON.parse(r.factorsJson),
    })),
    // Police/admin get the full auditable trail with reasoning metadata; a
    // citizen sees the same timeline of what happened, without the
    // internal decision-metadata payload attached to each step.
    auditLog: incident.auditLogs.map((a) => ({
      action: a.action,
      createdAt: a.createdAt,
      metadata: isAuthorityOrAdmin ? (a.metadataJson ? JSON.parse(a.metadataJson) : null) : null,
    })),
  });
});
