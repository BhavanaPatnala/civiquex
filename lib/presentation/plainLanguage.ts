// ---------------------------------------------------------------------------
// Plain-language layer for the incident detail screen. The rule/vision
// engines (lib/engines/*) produce precise, technical output — this module
// turns it into the handful of sentences a citizen or officer actually needs
// ("what happened", "where", "vehicle"), per the product rule: the system
// performs the complexity, the user never interprets it. Nothing here adds a
// new claim — every string is a rendering of a real field already computed
// upstream, with an honest "could not be determined" fallback wherever the
// real pipeline has no signal (never a guess).
// ---------------------------------------------------------------------------

import type { IncidentTypeCode } from "@/lib/types";

const WHAT_HAPPENED: Record<string, string> = {
  wrong_parking: "A vehicle appears to be parked in a no-parking zone.",
  footpath_obstruction: "A vehicle or object appears to be blocking a pedestrian footpath.",
  bus_stop_obstruction: "A vehicle appears to be obstructing a designated bus stop.",
  emergency_access_obstruction: "A vehicle appears to be blocking an emergency-access route.",
  school_zone_obstruction: "A vehicle appears to be obstructing a school-zone area.",
  accessible_parking_obstruction: "A vehicle appears to be occupying an accessible-parking space.",
  signage_obstruction: "A traffic sign or signal appears to be damaged or obscured.",
  dangerous_obstruction: "An object appears to be dangerously obstructing the roadway.",
  hazardous_interaction: "A potentially hazardous interaction between road users was observed.",
  pothole_damage: "Road surface damage consistent with a pothole was observed.",
};

export function whatHappened(incidentType: string): string {
  return WHAT_HAPPENED[incidentType] ?? "A road safety issue was observed.";
}

const INCIDENT_TYPE_PLAIN: Record<string, string> = {
  wrong_parking: "wrong parking",
  footpath_obstruction: "a footpath obstruction",
  bus_stop_obstruction: "a bus stop obstruction",
  emergency_access_obstruction: "an emergency-access obstruction",
  school_zone_obstruction: "a school-zone obstruction",
  accessible_parking_obstruction: "an accessible-parking obstruction",
  signage_obstruction: "signage damage",
  dangerous_obstruction: "a dangerous obstruction",
  hazardous_interaction: "a hazardous interaction",
  pothole_damage: "pothole damage",
};

// Only a genuinely real detector's output is trustworthy enough to describe
// what it did or didn't find — the demo vision stub (lib/ai/vision.ts) is a
// deterministic stand-in with no relationship to actual image content, so
// its output must never be presented as "what was captured."
const REAL_OBJECT_MODEL_PREFIX = "coco-ssd";
const ANOMALY_LABEL = "road_surface_anomaly";
const ANOMALY_MEANINGFUL_THRESHOLD = 0.6;

export interface CapturedDescription {
  text: string;
  /** True when a real detector ran and found nothing relevant — the UI should treat this as a strong "insufficient evidence" signal, not just quietly show the text. */
  nothingRelevant: boolean;
}

/**
 * Describes what the AI actually found in this specific recording — not a
 * template keyed off the category the reporter picked. If real object
 * detection ran and found nothing relevant to the reported incident type,
 * this says so plainly instead of asserting the reported violation happened.
 */
export function describeCaptured(
  incidentType: string,
  observation: { visionModel: string; detections: { label: string; confidence: number }[] } | null
): CapturedDescription {
  if (!observation || !observation.visionModel.startsWith(REAL_OBJECT_MODEL_PREFIX)) {
    // No real detector ran (demo-stub fallback, or no observation data at
    // all) — fall back to the category description, since there's no real
    // per-image signal to describe honestly either way.
    return { text: whatHappened(incidentType), nothingRelevant: false };
  }

  const objectLabels = Array.from(
    new Set(observation.detections.filter((d) => d.label !== ANOMALY_LABEL).map((d) => d.label.replace(/_/g, " ")))
  );
  const anomaly = observation.detections.find((d) => d.label === ANOMALY_LABEL);
  const anomalyMeaningful = !!anomaly && anomaly.confidence >= ANOMALY_MEANINGFUL_THRESHOLD;

  if (objectLabels.length === 0 && !anomalyMeaningful) {
    const typePlain = INCIDENT_TYPE_PLAIN[incidentType] ?? "this incident type";
    return {
      text: `No vehicle, person, or road-relevant object was detected in this recording. This does not appear to show ${typePlain} — evidence is marked insufficient rather than assumed.`,
      nothingRelevant: true,
    };
  }

  const parts: string[] = [];
  if (objectLabels.length > 0) {
    const shown = objectLabels.slice(0, 3).join(", ");
    parts.push(`${shown.charAt(0).toUpperCase()}${shown.slice(1)} detected in the recording`);
  }
  if (anomalyMeaningful) {
    parts.push("a possible road-surface irregularity was also flagged (an unverified visual heuristic, not a confirmed pothole)");
  }
  return { text: `${parts.join("; ")}.`, nothingRelevant: false };
}

export interface VehicleInfo {
  typeClass: string | null;
  colorClass: string | null;
}

/** Per the product rule: never guess a plate. If it can't be reliably read, say so. */
export function vehicleLine(vehicle: VehicleInfo | null): string {
  if (!vehicle || !vehicle.typeClass || vehicle.typeClass === "unknown") {
    return "Vehicle number could not be reliably determined.";
  }
  const color = vehicle.colorClass && vehicle.colorClass !== "unknown" ? `${vehicle.colorClass} ` : "";
  return `${color}${vehicle.typeClass.replace(/_/g, " ")} — plate not reliably determined.`;
}

export function locationVerifiedLine(locationConfidence: number): string {
  return locationConfidence >= 0.7 ? "Location verified." : "Location could not be fully verified.";
}

export function typeLabel(code: IncidentTypeCode | string, allTypes: { code: string; label: string }[]): string {
  return allTypes.find((t) => t.code === code)?.label ?? code.replace(/_/g, " ");
}
