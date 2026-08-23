import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, withApiHandler } from "@/lib/api/respond";
import { RECURRENCE_THRESHOLD } from "@/lib/engines/hotspot";

const schema = z.object({
  recurringOnly: z.enum(["true", "false"]).default("true"),
  riskLevel: z.string().optional(),
});

export const GET = withApiHandler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const q = schema.parse(Object.fromEntries(searchParams));

  const hotspots = await prisma.hotspot.findMany({
    where: {
      incidentCount: q.recurringOnly === "true" ? { gte: RECURRENCE_THRESHOLD } : undefined,
      riskLevel: q.riskLevel ? (q.riskLevel as never) : undefined,
    },
    include: {
      roadSegment: true,
      location: true,
      incidents: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, publicId: true, status: true, riskLevel: true, createdAt: true },
      },
    },
    orderBy: { incidentCount: "desc" },
  });

  return ok(
    hotspots.map((h) => ({
      id: h.id,
      incidentType: h.incidentType,
      incidentCount: h.incidentCount,
      recurringCount: h.recurringCount,
      avgDurationMinutes: h.avgDurationMinutes,
      riskLevel: h.riskLevel,
      firstSeenAt: h.firstSeenAt,
      lastSeenAt: h.lastSeenAt,
      roadSegment: h.roadSegment ? { id: h.roadSegment.id, name: h.roadSegment.name, schoolNearby: h.roadSegment.schoolNearby, hospitalNearby: h.roadSegment.hospitalNearby } : null,
      location: h.location ? { lat: h.location.lat, lng: h.location.lng } : null,
      recentIncidents: h.incidents,
    }))
  );
});
