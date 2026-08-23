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
