// ---------------------------------------------------------------------------
// Recurring Incident Engine
//
// Repeated incidents of the same type at the same location are not
// independent complaints — they are one recurring safety hotspot. This
// module decides recurrence and computes the hotspot's rollup stats.
// ---------------------------------------------------------------------------

import type { RiskLevelCode } from "@/lib/types";

export interface HotspotIncidentSample {
  incidentId: string;
  createdAt: Date;
  resolvedAt: Date | null;
  riskLevel: RiskLevelCode;
}

export interface HotspotComputation {
  isRecurring: boolean;
  incidentCount: number;
  recurringCount: number;
  avgDurationMinutes: number | null;
  riskLevel: RiskLevelCode;
  explanation: string;
}

export const RECURRENCE_THRESHOLD = 3; // >= this many same-type incidents within the lookback window => hotspot
export const HOTSPOT_LOOKBACK_DAYS = 90;

const LEVEL_ORDER: RiskLevelCode[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function computeHotspot(samples: HotspotIncidentSample[]): HotspotComputation {
  const incidentCount = samples.length;
  const isRecurring = incidentCount >= RECURRENCE_THRESHOLD;

  const durations = samples
    .filter((s) => s.resolvedAt)
    .map((s) => (s.resolvedAt!.getTime() - s.createdAt.getTime()) / 60000);
  const avgDurationMinutes = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  // Hotspot risk escalates with recurrence count and inherits the highest
  // individual incident risk observed, never lower than what recurrence alone implies.
  const highestIndividual = samples.reduce<RiskLevelCode>((max, s) => {
    return LEVEL_ORDER.indexOf(s.riskLevel) > LEVEL_ORDER.indexOf(max) ? s.riskLevel : max;
  }, "LOW");

  let recurrenceFloor: RiskLevelCode = "LOW";
  if (incidentCount >= 10) recurrenceFloor = "CRITICAL";
  else if (incidentCount >= 6) recurrenceFloor = "HIGH";
  else if (incidentCount >= RECURRENCE_THRESHOLD) recurrenceFloor = "MEDIUM";

  const riskLevel =
    LEVEL_ORDER.indexOf(recurrenceFloor) > LEVEL_ORDER.indexOf(highestIndividual) ? recurrenceFloor : highestIndividual;

  return {
    isRecurring,
    incidentCount,
    recurringCount: incidentCount,
    avgDurationMinutes,
    riskLevel,
    explanation: isRecurring
      ? `${incidentCount} incidents of this type recorded at this location within the last ${HOTSPOT_LOOKBACK_DAYS} days (threshold: ${RECURRENCE_THRESHOLD}) — treated as a recurring hotspot rather than independent complaints.`
      : `${incidentCount} incident(s) recorded — below the ${RECURRENCE_THRESHOLD}-incident recurrence threshold, not yet flagged as a hotspot.`,
  };
}
