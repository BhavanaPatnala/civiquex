import { prisma } from "@/lib/db";
import { ok, withApiHandler } from "@/lib/api/respond";
import { RECURRENCE_THRESHOLD } from "@/lib/engines/hotspot";

export const GET = withApiHandler(async () => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [
    totalIncidents,
    activeIncidents,
    highRiskIncidents,
    unresolvedIncidents,
    resolvedIncidents,
    recurringHotspots,
    todaysObservations,
    confidenceAgg,
    resolvedWithDuration,
    byType,
    recentIncidents,
  ] = await Promise.all([
    prisma.incident.count(),
    prisma.incident.count({ where: { status: { notIn: ["RESOLVED"] } } }),
    prisma.incident.count({ where: { riskLevel: { in: ["HIGH", "CRITICAL"] }, status: { notIn: ["RESOLVED"] } } }),
    prisma.incident.count({ where: { status: { in: ["OBSERVED", "EVIDENCE_VALIDATED", "STILL_PRESENT", "REOPENED"] } } }),
    prisma.incident.count({ where: { status: "RESOLVED" } }),
    prisma.hotspot.count({ where: { incidentCount: { gte: RECURRENCE_THRESHOLD } } }),
    prisma.observation.count({ where: { capturedAt: { gte: startOfToday } } }),
    prisma.incident.aggregate({ _avg: { evidenceConfidenceOverall: true } }),
    prisma.incident.findMany({ where: { status: "RESOLVED" }, select: { createdAt: true, updatedAt: true } }),
    prisma.incident.groupBy({ by: ["incidentType"], _count: { _all: true } }),
    prisma.incident.findMany({
      where: { createdAt: { gte: fourteenDaysAgo } },
      select: { createdAt: true, riskLevel: true },
    }),
  ]);

  const avgResolutionMinutes =
    resolvedWithDuration.length > 0
      ? resolvedWithDuration.reduce((sum, i) => sum + (i.updatedAt.getTime() - i.createdAt.getTime()) / 60000, 0) / resolvedWithDuration.length
      : null;

  const trendMap = new Map<string, { date: string; total: number; critical: number }>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    trendMap.set(key, { date: key, total: 0, critical: 0 });
  }
  for (const inc of recentIncidents) {
    const key = inc.createdAt.toISOString().slice(0, 10);
    const row = trendMap.get(key);
    if (row) {
      row.total += 1;
      if (inc.riskLevel === "CRITICAL") row.critical += 1;
    }
  }

  return ok({
    dataMode: process.env.DATA_MODE ?? "demo",
    totalIncidents,
    activeIncidents,
    highRiskIncidents,
    unresolvedIncidents,
    resolvedIncidents,
    recurringHotspots,
    resolutionRate: totalIncidents > 0 ? resolvedIncidents / totalIncidents : null,
    avgResolutionMinutes,
    avgEvidenceConfidence: confidenceAgg._avg.evidenceConfidenceOverall,
    todaysObservations,
    byIncidentType: byType.map((t) => ({ incidentType: t.incidentType, count: t._count._all })),
    trend: [...trendMap.values()],
  });
});
