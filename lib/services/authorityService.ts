import { prisma } from "@/lib/db";
import { resolveAuthority, type AuthorityCandidate, type RoutingFeedbackRecord } from "@/lib/engines/authority";
import type { LatLng } from "@/lib/geo";

async function loadCandidates(): Promise<AuthorityCandidate[]> {
  const authorities = await prisma.authority.findMany({ include: { boundaries: true } });
  return authorities.map((a) => ({
    id: a.id,
    name: a.name,
    jurisdiction: a.jurisdiction,
    supportedIncidentTypes: JSON.parse(a.supportedIncidentTypesJson),
    boundaries: a.boundaries.map((b) => JSON.parse(b.geojson) as [number, number][]),
    apiAvailable: a.apiAvailable,
    submissionMethod: a.submissionMethod as AuthorityCandidate["submissionMethod"],
  }));
}

export async function resolveIncidentAuthority(input: {
  point: LatLng;
  incidentType: string;
  roadSegmentId: string | null;
}) {
  const [candidates, feedbackRows] = await Promise.all([
    loadCandidates(),
    prisma.routingFeedback.findMany({
      where: input.roadSegmentId ? { roadSegmentId: input.roadSegmentId, incidentType: input.incidentType } : { incidentType: input.incidentType },
    }),
  ]);

  const feedback: RoutingFeedbackRecord[] = feedbackRows.map((f) => ({
    authorityId: f.authorityId,
    outcome: f.outcome as "accepted" | "redirected",
    redirectedToId: f.redirectedToId,
    roadSegmentId: f.roadSegmentId,
    incidentType: f.incidentType,
  }));

  return resolveAuthority({
    point: input.point,
    incidentType: input.incidentType,
    roadSegmentId: input.roadSegmentId,
    authorities: candidates,
    feedback,
  });
}

/** Records an authority's response to a submission (accepted / redirected) into the auditable feedback log the routing engine learns from. */
export async function recordRoutingFeedback(input: {
  authorityId: string;
  outcome: "accepted" | "redirected";
  redirectedToId?: string | null;
  roadSegmentId: string | null;
  incidentType: string;
}) {
  return prisma.routingFeedback.create({
    data: {
      authorityId: input.authorityId,
      outcome: input.outcome,
      redirectedToId: input.redirectedToId ?? null,
      roadSegmentId: input.roadSegmentId,
      incidentType: input.incidentType,
    },
  });
}
