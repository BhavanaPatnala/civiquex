import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, withApiHandler } from "@/lib/api/respond";
import { RECURRENCE_THRESHOLD } from "@/lib/engines/hotspot";
import type { Prisma } from "@prisma/client";

const schema = z.object({
  incidentType: z.string().optional(),
  riskLevel: z.string().optional(),
  status: z.string().optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const GET = withApiHandler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const q = schema.parse(Object.fromEntries(searchParams));

  const where: Prisma.IncidentWhereInput = {
    incidentType: q.incidentType,
    riskLevel: q.riskLevel,
    status: q.status,
    evidenceConfidenceOverall: q.minConfidence ? { gte: q.minConfidence } : undefined,
    createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
  };

  const [incidents, hotspots] = await Promise.all([
    prisma.incident.findMany({
      where,
      include: { location: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.hotspot.findMany({
      where: { incidentCount: { gte: RECURRENCE_THRESHOLD } },
      include: { location: true, roadSegment: true },
    }),
  ]);

  return ok({
    dataMode: process.env.DATA_MODE ?? "demo",
    incidents: incidents
      .filter((i) => i.location)
      .map((i) => ({
        id: i.id,
        publicId: i.publicId,
        incidentType: i.incidentType,
        status: i.status,
        riskLevel: i.riskLevel,
        evidenceConfidence: i.evidenceConfidenceOverall,
        recurring: i.recurring,
        lat: i.location!.lat,
        lng: i.location!.lng,
        createdAt: i.createdAt,
      })),
    hotspots: hotspots
      .filter((h) => h.location)
      .map((h) => ({
        id: h.id,
        incidentType: h.incidentType,
        incidentCount: h.incidentCount,
        riskLevel: h.riskLevel,
        lat: h.location!.lat,
        lng: h.location!.lng,
        roadSegmentName: h.roadSegment?.name ?? null,
      })),
  });
});
