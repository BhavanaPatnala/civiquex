import { prisma } from "@/lib/db";
import { distanceToPolyline } from "@/lib/geo";
import type { RoadSegmentContext } from "@/lib/types";
import type { RoadSegment } from "@prisma/client";

const MATCH_RADIUS_METERS = 60;

export function toRoadSegmentContext(seg: RoadSegment): RoadSegmentContext {
  return {
    id: seg.id,
    name: seg.name,
    roadClass: seg.roadClass,
    schoolNearby: seg.schoolNearby,
    hospitalNearby: seg.hospitalNearby,
    junctionType: seg.junctionType,
  };
}

/** Finds the nearest road segment to a point, within MATCH_RADIUS_METERS. All segments are pre-loaded (demo-scale dataset) — swap for a PostGIS ST_DWithin/ST_ClosestPoint query at production scale. */
export async function matchRoadSegment(lat: number, lng: number): Promise<RoadSegment | null> {
  const segments = await prisma.roadSegment.findMany();
  let best: { segment: RoadSegment; distance: number } | null = null;

  for (const seg of segments) {
    const line = JSON.parse(seg.geometryJson) as [number, number][];
    const d = distanceToPolyline({ lat, lng }, line);
    if (!best || d < best.distance) best = { segment: seg, distance: d };
  }

  if (best && best.distance <= MATCH_RADIUS_METERS) return best.segment;
  return null;
}
