import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ok, withApiHandler } from "@/lib/api/respond";
import type { Prisma } from "@prisma/client";

const listSchema = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
  status: z.string().optional(),
  riskLevel: z.string().optional(),
  incidentType: z.string().optional(),
  authorityId: z.string().optional(),
  recurring: z.enum(["true", "false"]).optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().optional(),
  minLat: z.coerce.number().optional(),
  maxLat: z.coerce.number().optional(),
  minLng: z.coerce.number().optional(),
  maxLng: z.coerce.number().optional(),
});

export const GET = withApiHandler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const q = listSchema.parse(Object.fromEntries(searchParams));

  // Access control: the Incidents repository (full search/browse) is
  // authority/admin only. A citizen — or anyone unauthenticated — can only
  // ever see incidents built from their own submissions, never the wider
  // repository, however the query is shaped. This is enforced here, not
  // just hidden in the UI, so it holds even against a direct API call.
  const session = await getSession();
  const isAuthorityOrAdmin = session?.role === "AUTHORITY" || session?.role === "ADMIN";
  const ownershipFilter: Prisma.IncidentWhereInput | undefined = isAuthorityOrAdmin
    ? undefined
    : session
      ? { observations: { some: { observation: { userId: session.id } } } }
      : { id: "__no_access__" }; // unauthenticated: no incidents are "theirs"

  // An officer's default view is their own authority's queue, not the whole
  // city — unless they explicitly pass a different authorityId (only an
  // ADMIN's cross-authority view relies on that override in practice).
  const authorityScope = q.authorityId ?? (session?.role === "AUTHORITY" ? session.authorityId ?? undefined : undefined);

  const where: Prisma.IncidentWhereInput = {
    ...ownershipFilter,
    status: q.status,
    riskLevel: q.riskLevel,
    incidentType: q.incidentType,
    authorityId: authorityScope,
    recurring: q.recurring ? q.recurring === "true" : undefined,
    evidenceConfidenceOverall: q.minConfidence ? { gte: q.minConfidence } : undefined,
    createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
    publicId: q.q ? { contains: q.q } : undefined,
    location:
      q.minLat != null && q.maxLat != null && q.minLng != null && q.maxLng != null
        ? { lat: { gte: q.minLat, lte: q.maxLat }, lng: { gte: q.minLng, lte: q.maxLng } }
        : undefined,
  };

  const [incidents, total] = await Promise.all([
    prisma.incident.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.limit,
      skip: q.offset,
      include: {
        location: true,
        roadSegment: true,
        authority: { select: { id: true, name: true } },
        hotspot: { select: { id: true, incidentCount: true } },
        observations: {
          select: { id: true, observation: { select: { media: { select: { kind: true, storageRef: true } } } } },
        },
      },
    }),
    prisma.incident.count({ where }),
  ]);

  return ok({
    total,
    limit: q.limit,
    offset: q.offset,
    incidents: incidents.map((inc) => {
      // Demo-seeded/simulated observations carry synthetic media refs with no
      // real bytes behind them (see MediaPreview's same check in
      // evidence-timeline.tsx) — only a genuine "/api/media/..." ref (routed
      // through the session-gated proxy) is safe to render as a thumbnail.
      const thumbnailMedia = inc.observations.map((o) => o.observation.media).find((m) => m?.storageRef.startsWith("/api/media/"));

      return {
        id: inc.id,
        publicId: inc.publicId,
        incidentType: inc.incidentType,
        status: inc.status,
        riskLevel: inc.riskLevel,
        evidenceConfidence: inc.evidenceConfidenceOverall,
        evidenceConfidenceOverall: inc.evidenceConfidenceOverall,
        evidenceConfidenceBreakdown: JSON.parse(inc.evidenceConfidenceBreakdown),
        ruleVerdict: inc.ruleVerdict,
        recurring: inc.recurring,
        observationCount: inc.observations.length,
        thumbnail: thumbnailMedia ? { kind: thumbnailMedia.kind, url: thumbnailMedia.storageRef } : null,
        location: inc.location ? { lat: inc.location.lat, lng: inc.location.lng, address: inc.location.address } : null,
        roadSegment: inc.roadSegment ? { id: inc.roadSegment.id, name: inc.roadSegment.name } : null,
        authority: inc.authority,
        hotspotIncidentCount: inc.hotspot?.incidentCount ?? null,
        createdAt: inc.createdAt,
        updatedAt: inc.updatedAt,
      };
    }),
  });
});
