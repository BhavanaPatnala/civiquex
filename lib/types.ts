// Shared domain types for the engine layer (lib/engines/*). These are plain
// data shapes decoupled from Prisma models so the engines stay pure,
// synchronous, and unit-testable — thin service wrappers in lib/services/*
// translate Prisma rows into these shapes and back.

export type IncidentTypeCode =
  | "wrong_parking"
  | "footpath_obstruction"
  | "bus_stop_obstruction"
  | "emergency_access_obstruction"
  | "school_zone_obstruction"
  | "accessible_parking_obstruction"
  | "signage_obstruction"
  | "dangerous_obstruction"
  | "hazardous_interaction"
  | "pothole_damage";

export const INCIDENT_TYPES: { code: IncidentTypeCode; label: string }[] = [
  { code: "wrong_parking", label: "Wrong / illegal parking" },
  { code: "footpath_obstruction", label: "Footpath obstruction" },
  { code: "bus_stop_obstruction", label: "Bus-stop obstruction" },
  { code: "emergency_access_obstruction", label: "Emergency-access obstruction" },
  { code: "school_zone_obstruction", label: "School-zone obstruction" },
  { code: "accessible_parking_obstruction", label: "Accessible-parking obstruction" },
  { code: "signage_obstruction", label: "Traffic-sign / signal obstruction or damage" },
  { code: "dangerous_obstruction", label: "Dangerous road obstruction" },
  { code: "hazardous_interaction", label: "Potentially hazardous traffic interaction" },
  { code: "pothole_damage", label: "Pothole / road surface damage" },
];

export interface RoadSegmentContext {
  id: string;
  name: string;
  roadClass: "arterial" | "collector" | "local" | "school_zone" | string;
  schoolNearby: boolean;
  hospitalNearby: boolean;
  junctionType: "signalized" | "unsignalized" | "roundabout" | "none" | string | null;
}

export interface RuleTimeWindow {
  startHour: number;
  endHour: number;
  days?: number[]; // 0 = Sunday .. 6 = Saturday; omitted = every day
}

export interface RuleConditions {
  timeWindows?: RuleTimeWindow[];
  requiresSchoolNearby?: boolean;
  requiresHospitalNearby?: boolean;
  roadClasses?: string[];
  minVisualConfidence?: number;
}

export interface RuleDef {
  id: string;
  code: string;
  incidentType: string;
  description: string;
  conditions: RuleConditions;
  authoritySource: string;
}

export interface DetectionLike {
  label: string;
  confidence: number;
}

export type RuleVerdict = "potential_violation" | "evidence_insufficient" | "requires_verification";

export interface ObservationLite {
  id: string;
  sourceType: "CITIZEN" | "DASHCAM" | "AUTHORIZED_SENSOR";
  incidentTypeGuess: string;
  capturedAt: string; // ISO
  lat: number;
  lng: number;
  orientationDeg: number | null;
  roadSegmentId: string | null;
  vehicleFingerprint: string | null;
  sceneDescriptor: number[];
  detections: DetectionLike[];
  visualQuality: number;
}

export interface CorrelationFactors {
  temporal: number;
  spatial: number;
  trajectory: number;
  scene: number;
  appearance: number;
  incidentTypeMatch: number;
}

export interface EvidenceConfidenceBreakdown {
  visual: number;
  location: number;
  temporal: number;
  rule: number;
  scene: number;
  corroboration: number;
}

export type RiskLevelCode = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskFactors {
  frequency: number;
  recurrence: number;
  pedestrianExposure: number;
  visibilityObstruction: number;
  proximityRisk: number; // school/hospital/junction
  timeOfDayRisk: number;
}
