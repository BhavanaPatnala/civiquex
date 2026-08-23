import { prisma } from "@/lib/db";
import { computeHotspot, HOTSPOT_LOOKBACK_DAYS, type HotspotIncidentSample } from "@/lib/engines/hotspot";
import type { RiskLevelCode } from "@/lib/types";

/** Recomputes the hotspot rollup for a given road segment + incident type after an incident is created/updated, and links the incident to it. */
export async function refreshHotspot(roadSegmentId: string, incidentType: string): Promise<{ hotspotId: string; isRecurring: boolean }> {
  const since = new Date(Date.now() - HOTSPOT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const incidents = await prisma.incident.findMany({
    where: { roadSegmentId, incidentType, createdAt: { gte: since } },
    include: { resolutionChecks: { orderBy: { checkedAt: "desc" }, take: 1 } },
  });

  const samples: HotspotIncidentSample[] = incidents.map((inc) => ({
    incidentId: inc.id,
    createdAt: inc.createdAt,
    resolvedAt: inc.status === "RESOLVED" ? inc.updatedAt : null,
    riskLevel: inc.riskLevel as RiskLevelCode,
  }));

  const computed = computeHotspot(samples);

  const existing = await prisma.hotspot.findFirst({ where: { roadSegmentId, incidentType } });

  const hotspot = existing
    ? await prisma.hotspot.update({
        where: { id: existing.id },
        data: {
          incidentCount: computed.incidentCount,
          recurringCount: computed.recurringCount,
          avgDurationMinutes: computed.avgDurationMinutes,
          riskLevel: computed.riskLevel,
          lastSeenAt: new Date(),
        },
      })
    : await prisma.hotspot.create({
        data: {
          roadSegmentId,
          locationId: incidents[0]?.locationId ?? null,
          incidentType,
          incidentCount: computed.incidentCount,
          recurringCount: computed.recurringCount,
          avgDurationMinutes: computed.avgDurationMinutes,
          riskLevel: computed.riskLevel,
          firstSeenAt: incidents.reduce((min, i) => (i.createdAt < min ? i.createdAt : min), new Date()),
          lastSeenAt: new Date(),
        },
      });

  if (computed.isRecurring) {
    await prisma.incident.updateMany({
      where: { id: { in: incidents.map((i) => i.id) } },
      data: { recurring: true, hotspotId: hotspot.id },
    });
  }

  return { hotspotId: hotspot.id, isRecurring: computed.isRecurring };
}
