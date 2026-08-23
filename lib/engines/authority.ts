// ---------------------------------------------------------------------------
// Authority Resolution Engine
//
// A citizen should never need to know which department handles a problem.
// This resolves GPS + incident type -> jurisdiction -> responsible
// authority -> official submission channel, using real registered
// boundaries and rule data only. If no authority/channel exists, the result
// is explicitly "unavailable" — this module never fabricates an API.
//
// It also folds in Authority Feedback Learning: when an authority redirects
// a submission ("wrong department"), that outcome is logged
// (RoutingFeedback) and read back here to bias future routing for the same
// road segment + incident type. The full decision trail is always returned
// so routing is auditable, never a black box.
// ---------------------------------------------------------------------------

import { pointInPolygon, polygonBoundingBoxArea, type LatLng } from "@/lib/geo";

export interface AuthorityCandidate {
  id: string;
  name: string;
  jurisdiction: string;
  supportedIncidentTypes: string[];
  boundaries: [number, number][][]; // one or more polygons, GeoJSON [lng,lat] order
  apiAvailable: boolean;
  submissionMethod: "official_api" | "assisted_manual" | "unavailable";
}

export interface RoutingFeedbackRecord {
  authorityId: string;
  outcome: "accepted" | "redirected";
  redirectedToId: string | null;
  roadSegmentId: string | null;
  incidentType: string;
}

export interface AuthorityResolutionResult {
  authorityId: string | null;
  confidence: number;
  submissionMethod: "official_api" | "assisted_manual" | "unavailable";
  decisionTrail: string[];
  learnedOverride: boolean;
}

export function resolveAuthority(input: {
  point: LatLng;
  incidentType: string;
  roadSegmentId: string | null;
  authorities: AuthorityCandidate[];
  feedback: RoutingFeedbackRecord[];
}): AuthorityResolutionResult {
  const trail: string[] = [];

  // Track each matching authority's smallest matching boundary (in degrees²)
  // so a tight, specific zone always outranks a broad catch-all that
  // happens to also cover the point (e.g. a state-wide fallback boundary
  // necessarily contains every city zone within it too).
  const specificity = new Map<string, number>();
  for (const a of input.authorities) {
    const matchedAreas = a.boundaries.filter((poly) => pointInPolygon(input.point, poly)).map(polygonBoundingBoxArea);
    if (matchedAreas.length > 0) specificity.set(a.id, Math.min(...matchedAreas));
  }
  const geoMatches = input.authorities
    .filter((a) => specificity.has(a.id))
    .sort((a, b) => specificity.get(a.id)! - specificity.get(b.id)!);
  trail.push(
    geoMatches.length > 0
      ? `Jurisdiction lookup: location falls within ${geoMatches.length} registered boundary/boundaries (${geoMatches.map((a) => a.name).join(", ")}).`
      : "Jurisdiction lookup: location does not fall within any registered authority boundary."
  );

  if (geoMatches.length === 0) {
    return {
      authorityId: null,
      confidence: 0,
      submissionMethod: "unavailable",
      decisionTrail: [...trail, "External submission unavailable — no authority boundary covers this location."],
      learnedOverride: false,
    };
  }

  const typeMatches = geoMatches.filter((a) => a.supportedIncidentTypes.includes(input.incidentType));
  trail.push(
    typeMatches.length > 0
      ? `Incident-type match: ${typeMatches.map((a) => a.name).join(", ")} handle "${input.incidentType.replaceAll("_", " ")}".`
      : `Incident-type match: none of the jurisdictional authorities list "${input.incidentType.replaceAll("_", " ")}" as a supported category.`
  );

  if (typeMatches.length === 0) {
    return {
      authorityId: null,
      confidence: 0,
      submissionMethod: "unavailable",
      decisionTrail: [...trail, "External submission unavailable — no registered authority accepts this incident type here. Use the assisted manual workflow."],
      learnedOverride: false,
    };
  }

  let chosen = typeMatches[0];
  let confidence = 0.75;
  let learnedOverride = false;

  const relevantFeedback = input.feedback.filter(
    (f) => f.roadSegmentId === input.roadSegmentId && f.incidentType === input.incidentType
  );

  if (relevantFeedback.length >= 3) {
    const tally = new Map<string, { accepted: number; redirected: number }>();
    for (const f of relevantFeedback) {
      const row = tally.get(f.authorityId) ?? { accepted: 0, redirected: 0 };
      if (f.outcome === "accepted") row.accepted += 1;
      else row.redirected += 1;
      tally.set(f.authorityId, row);
    }

    const chosenStats = tally.get(chosen.id);
    const redirectRate = chosenStats ? chosenStats.redirected / (chosenStats.accepted + chosenStats.redirected) : 0;

    if (chosenStats && redirectRate > 0.6) {
      // Find where redirects from the chosen authority most often landed.
      const redirectTargets = relevantFeedback.filter((f) => f.authorityId === chosen.id && f.redirectedToId);
      const targetTally = new Map<string, number>();
      for (const f of redirectTargets) {
        targetTally.set(f.redirectedToId!, (targetTally.get(f.redirectedToId!) ?? 0) + 1);
      }
      const bestTarget = [...targetTally.entries()].sort((a, b) => b[1] - a[1])[0];
      const alt = bestTarget ? typeMatches.find((a) => a.id === bestTarget[0]) : undefined;

      trail.push(
        `Authority feedback learning: ${chosen.name} was redirected away from ${(redirectRate * 100).toFixed(0)}% of ${chosenStats.accepted + chosenStats.redirected} past submissions for this exact road segment + incident type.`
      );

      if (alt) {
        trail.push(`Most redirects landed at ${alt.name} — routing updated to prefer ${alt.name} for this segment + incident type.`);
        chosen = alt;
        confidence = 0.7;
        learnedOverride = true;
      } else {
        trail.push("No consistent redirect target found — falling back to the default jurisdictional match.");
      }
    } else if (chosenStats) {
      confidence = Math.min(0.97, 0.75 + (chosenStats.accepted / (chosenStats.accepted + chosenStats.redirected)) * 0.2);
      trail.push(`Authority feedback learning: ${chosen.name} has an accepted history (${chosenStats.accepted}/${chosenStats.accepted + chosenStats.redirected}) for this segment + incident type — routing confidence increased.`);
    }
  } else {
    trail.push("Authority feedback learning: fewer than 3 prior routing outcomes for this exact segment + incident type — using default jurisdictional match.");
  }

  trail.push(
    chosen.submissionMethod === "official_api"
      ? `Routed to ${chosen.name} via official API.`
      : chosen.submissionMethod === "assisted_manual"
        ? `Routed to ${chosen.name} — no public API available; using the assisted manual submission workflow.`
        : `${chosen.name} has no available submission channel — external submission unavailable.`
  );

  return {
    authorityId: chosen.id,
    confidence,
    submissionMethod: chosen.submissionMethod,
    decisionTrail: trail,
    learnedOverride,
  };
}
