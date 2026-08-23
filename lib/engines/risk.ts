// ---------------------------------------------------------------------------
// Risk Intelligence Engine
//
// Risk is not a violation count. It combines frequency, recurrence,
// pedestrian exposure, road geometry, protected-proximity (school/hospital/
// junction), visibility obstruction, and time-of-day into an explainable
// score and a LOW/MEDIUM/HIGH/CRITICAL level.
// ---------------------------------------------------------------------------

import type { IncidentTypeCode, RiskFactors, RiskLevelCode, RoadSegmentContext } from "@/lib/types";

export interface RiskInput {
  incidentType: IncidentTypeCode | string;
  roadSegment: RoadSegmentContext | null;
  capturedAt: Date;
  recurringIncidentCountAtLocation: number; // how many prior incidents of this type at this location/segment
  avgVisualQuality: number; // used as a rough proxy for obstruction severity/visibility impact
}

export interface RiskResult {
  score: number; // 0-1
  level: RiskLevelCode;
  factors: RiskFactors;
  explanation: string[];
}

const PEDESTRIAN_EXPOSURE_BY_TYPE: Record<string, number> = {
  footpath_obstruction: 0.9,
  school_zone_obstruction: 0.95,
  bus_stop_obstruction: 0.8,
  accessible_parking_obstruction: 0.75,
  hazardous_interaction: 0.85,
  emergency_access_obstruction: 0.6,
  wrong_parking: 0.4,
  signage_obstruction: 0.5,
  dangerous_obstruction: 0.7,
};

const VISIBILITY_OBSTRUCTION_BY_TYPE: Record<string, number> = {
  signage_obstruction: 0.9,
  dangerous_obstruction: 0.85,
  hazardous_interaction: 0.75,
  wrong_parking: 0.5,
  footpath_obstruction: 0.45,
  bus_stop_obstruction: 0.5,
  school_zone_obstruction: 0.6,
  emergency_access_obstruction: 0.55,
  accessible_parking_obstruction: 0.35,
};

function timeOfDayRisk(at: Date): number {
  const hour = at.getHours();
  // School run / commute peaks and low-light evening hours carry more risk.
  if ((hour >= 7 && hour < 9) || (hour >= 14 && hour < 16) || (hour >= 17 && hour < 20)) return 0.85;
  if (hour >= 22 || hour < 6) return 0.6;
  return 0.4;
}

export function computeRisk(input: RiskInput): RiskResult {
  const frequency = Math.min(1, input.recurringIncidentCountAtLocation / 10);
  const recurrence = input.recurringIncidentCountAtLocation >= 3 ? Math.min(1, 0.5 + input.recurringIncidentCountAtLocation / 20) : 0.2;
  const pedestrianExposure = PEDESTRIAN_EXPOSURE_BY_TYPE[input.incidentType] ?? 0.5;
  const visibilityObstruction = VISIBILITY_OBSTRUCTION_BY_TYPE[input.incidentType] ?? 0.5;

  let proximityRisk = 0.2;
  const proximityReasons: string[] = [];
  if (input.roadSegment?.schoolNearby) {
    proximityRisk += 0.35;
    proximityReasons.push("school zone nearby");
  }
  if (input.roadSegment?.hospitalNearby) {
    proximityRisk += 0.25;
    proximityReasons.push("hospital / emergency access nearby");
  }
  if (input.roadSegment?.junctionType && input.roadSegment.junctionType !== "none") {
    proximityRisk += input.roadSegment.junctionType === "unsignalized" ? 0.3 : 0.15;
    proximityReasons.push(`${input.roadSegment.junctionType} junction`);
  }
  proximityRisk = Math.min(1, proximityRisk);

  const timeRisk = timeOfDayRisk(input.capturedAt);

  const factors: RiskFactors = {
    frequency,
    recurrence,
    pedestrianExposure,
    visibilityObstruction,
    proximityRisk,
    timeOfDayRisk: timeRisk,
  };

  const score =
    factors.frequency * 0.15 +
    factors.recurrence * 0.25 +
    factors.pedestrianExposure * 0.2 +
    factors.visibilityObstruction * 0.15 +
    factors.proximityRisk * 0.15 +
    factors.timeOfDayRisk * 0.1;

  const level: RiskLevelCode = score >= 0.75 ? "CRITICAL" : score >= 0.55 ? "HIGH" : score >= 0.32 ? "MEDIUM" : "LOW";

  const explanation = [
    `Historical recurrence at this location: ${input.recurringIncidentCountAtLocation} prior incident(s) of this type (${(recurrence * 100).toFixed(0)}% recurrence weight).`,
    `Pedestrian exposure for "${input.incidentType.replaceAll("_", " ")}": ${(pedestrianExposure * 100).toFixed(0)}%.`,
    `Visibility obstruction severity: ${(visibilityObstruction * 100).toFixed(0)}%.`,
    proximityReasons.length > 0
      ? `Elevated proximity risk: ${proximityReasons.join(", ")} (${(proximityRisk * 100).toFixed(0)}%).`
      : `No school/hospital/junction proximity factors identified (${(proximityRisk * 100).toFixed(0)}%).`,
    `Time-of-day risk at capture time: ${(timeRisk * 100).toFixed(0)}%.`,
  ];

  return { score, level, factors, explanation };
}
