import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, withApiHandler } from "@/lib/api/respond";
import { resolveIncidentAuthority } from "@/lib/services/authorityService";
import { matchRoadSegment } from "@/lib/services/roadSegments";

const schema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  incidentType: z.string(),
});

export const GET = withApiHandler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const q = schema.parse(Object.fromEntries(searchParams));

  const roadSegment = await matchRoadSegment(q.lat, q.lng);
  const resolution = await resolveIncidentAuthority({
    point: { lat: q.lat, lng: q.lng },
    incidentType: q.incidentType,
    roadSegmentId: roadSegment?.id ?? null,
  });

  const authority = resolution.authorityId ? await prisma.authority.findUnique({ where: { id: resolution.authorityId } }) : null;

  return ok({
    roadSegment: roadSegment ? { id: roadSegment.id, name: roadSegment.name } : null,
    authority: authority ? { id: authority.id, name: authority.name, jurisdiction: authority.jurisdiction, submissionMethod: authority.submissionMethod } : null,
    confidence: resolution.confidence,
    decisionTrail: resolution.decisionTrail,
    submissionMethod: resolution.submissionMethod,
    learnedOverride: resolution.learnedOverride,
  });
});
