// ---------------------------------------------------------------------------
// Observation Pipeline — the OBSERVE -> UNDERSTAND -> VERIFY -> CORRELATE ->
// ASSESS RISK -> ROUTE orchestrator. Every observation (citizen capture,
// dashcam, authorized sensor, or the demo simulation stream) enters here.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";
import { runVisionInference, type VisionResult } from "@/lib/ai/vision";
import { correlateObservation, type CorrelationCandidate } from "@/lib/engines/correlation";
import { computeEvidenceConfidence } from "@/lib/engines/confidence";
import { evaluateRule } from "@/lib/engines/rules";
import { computeRisk } from "@/lib/engines/risk";
import { matchRoadSegment, toRoadSegmentContext } from "@/lib/services/roadSegments";
import { reverseGeocode } from "@/lib/services/geocode";
import { loadRulesFor } from "@/lib/services/rules";
import { resolveIncidentAuthority } from "@/lib/services/authorityService";
import { refreshHotspot } from "@/lib/services/hotspotService";
import { formatPublicIncidentId } from "@/lib/ids";
import { eventBus } from "@/lib/realtime/bus";
import type { ObservationLite } from "@/lib/types";
import type { Observation } from "@prisma/client";

export type ObservationSourceType = "CITIZEN" | "DASHCAM" | "AUTHORIZED_SENSOR";

const OPEN_INCIDENT_WINDOW_MINUTES = 25;
const RETENTION_DAYS = 180;

export interface CreateObservationInput {
  userId?: string | null;
  sourceType: ObservationSourceType;
  observerHash: string;
  incidentTypeGuess: string;
  capturedAt: Date;
  lat: number;
  lng: number;
  orientationDeg?: number | null;
  mediaKind: "video" | "image";
  mediaRef: string;
  storageRef?: string;
  blobUrl?: string | null;
  gpsAccuracyMeters?: number;
  uploadDelaySeconds?: number;
  vehicleFingerprint?: string | null;
  /**
   * Real, already-computed AI detection output (e.g. from the Road Patrol
   * flow's client-side TensorFlow.js inference) to use instead of the demo
   * vision stub. When present, every downstream engine (rule, confidence,
   * correlation, resolution) runs on genuine detections rather than the
   * deterministic stand-in — see lib/ai/vision.ts's module comment.
   */
  visionOverride?: VisionResult;
}

function toObservationLite(o: Observation, vehicleFingerprint: string | null): ObservationLite {
  return {
    id: o.id,
    sourceType: o.sourceType as ObservationLite["sourceType"],
    incidentTypeGuess: o.incidentTypeGuess,
    capturedAt: o.capturedAt.toISOString(),
    lat: o.lat,
    lng: o.lng,
    orientationDeg: o.orientationDeg,
    roadSegmentId: o.roadSegmentId,
    vehicleFingerprint,
    sceneDescriptor: JSON.parse(o.sceneDescriptorJson),
    detections: JSON.parse(o.objectDetectionsJson),
    visualQuality: 0,
  };
}

export async function createObservation(input: CreateObservationInput) {
  const vision =
    input.visionOverride ??
    runVisionInference({
      mediaRef: input.mediaRef,
      incidentTypeGuess: input.incidentTypeGuess,
      capturedAt: input.capturedAt.toISOString(),
    });

  const windowStart = new Date(input.capturedAt.getTime() - OPEN_INCIDENT_WINDOW_MINUTES * 60 * 1000);
  const windowEnd = new Date(input.capturedAt.getTime() + OPEN_INCIDENT_WINDOW_MINUTES * 60 * 1000);

  // Every DB round-trip here costs real network latency to a remote
  // Postgres, independent of how trivial the query itself is (measured:
  // ~500ms each). None of these four reads/writes depends on any of the
  // others' results, so running them one at a time was pure added latency —
  // batched, this is one round-trip's worth of wall time instead of four.
  const [roadSegment, rules, openIncidents, evidence, vehicle] = await Promise.all([
    matchRoadSegment(input.lat, input.lng),
    loadRulesFor(input.incidentTypeGuess),
    // Candidates are narrowed by the real-world capture time of their most
    // recent linked observation — never by the incident row's DB insert
    // timestamp, which can diverge arbitrarily from event time (backfilled
    // history, delayed uploads, batch processing).
    prisma.incident.findMany({
      where: {
        incidentType: input.incidentTypeGuess,
        status: { notIn: ["RESOLVED"] },
        observations: {
          some: { observation: { capturedAt: { gte: windowStart, lte: windowEnd } } },
        },
      },
      relationLoadStrategy: "join",
      include: {
        observations: {
          include: { observation: { include: { vehicle: true } } },
          orderBy: { addedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.evidence.create({
      data: {
        kind: input.mediaKind,
        storageRef: input.storageRef ?? input.mediaRef,
        blobUrl: input.blobUrl ?? null,
        facesBlurred: true,
        encrypted: true,
        contentHash: input.mediaRef,
        retentionUntil: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
      },
    }),
    input.vehicleFingerprint
      ? prisma.vehicle.upsert({
          where: { fingerprintHash: input.vehicleFingerprint },
          update: {},
          create: {
            fingerprintHash: input.vehicleFingerprint,
            typeClass: "unknown",
            colorClass: "unknown",
          },
        })
      : Promise.resolve(null),
  ]);
  const roadSegmentContext = roadSegment ? toRoadSegmentContext(roadSegment) : null;
  const vehicleId = vehicle?.id ?? null;

  // roadSegment only matches the small, hand-seeded set of demo Chennai road
  // segments (it exists to drive rule context — school/hospital proximity —
  // which genuinely has no data outside that set). The human-readable address
  // shown to the user is a separate concern: fall back to a real reverse
  // geocode (OpenStreetMap Nominatim — see lib/services/geocode.ts) for any
  // GPS point outside the demo geofence, so real-world submissions get a real
  // place name instead of "Unmatched location". Only when even that lookup
  // fails (offline, GPS missing) do we fall back to the honest placeholder.
  let address = roadSegment?.name ?? null;
  if (!address) {
    const geocoded = await reverseGeocode(input.lat, input.lng);
    address = geocoded?.road ?? geocoded?.displayName ?? null;
  }

  const location = await prisma.location.create({
    data: {
      lat: input.lat,
      lng: input.lng,
      address: address ?? "Unmatched location",
      roadSegmentId: roadSegment?.id ?? null,
    },
  });

  const observation = await prisma.observation.create({
    data: {
      userId: input.userId ?? null,
      vehicleId,
      sourceType: input.sourceType,
      observerHash: input.observerHash,
      incidentTypeGuess: input.incidentTypeGuess,
      capturedAt: input.capturedAt,
      lat: input.lat,
      lng: input.lng,
      orientationDeg: input.orientationDeg ?? null,
      roadSegmentId: roadSegment?.id ?? null,
      locationId: location.id,
      sceneDescriptorJson: JSON.stringify(vision.sceneDescriptor),
      objectDetectionsJson: JSON.stringify(vision.detections),
      visionModel: vision.model,
      visionModelVersion: vision.modelVersion,
      status: "PROCESSED",
      mediaId: evidence.id,
    },
  });

  eventBus.emit("observation.created", { observationId: observation.id, incidentType: input.incidentTypeGuess, lat: input.lat, lng: input.lng });

  // --- CORRELATE -------------------------------------------------------
  // openIncidents was already fetched in the initial parallel batch above —
  // it doesn't depend on the observation just created, only on incidentType
  // + capture-time window, both known from the start.
  const candidates: CorrelationCandidate[] = openIncidents
    .filter((inc) => inc.observations[0])
    .map((inc) => ({
      incidentId: inc.id,
      incidentType: inc.incidentType,
      roadSegmentId: inc.roadSegmentId,
      anchorObservation: toObservationLite(
        inc.observations[0].observation,
        inc.observations[0].observation.vehicle?.fingerprintHash ?? null
      ),
    }));

  const newObsLite = toObservationLite(observation, input.vehicleFingerprint ?? null);
  const correlation = correlateObservation(newObsLite, candidates);

  const detectionsLite = vision.detections.map((d) => ({ label: d.label, confidence: d.confidence }));

  // rules was already fetched in the initial parallel batch above.
  const ruleResult = evaluateRule({
    incidentType: input.incidentTypeGuess,
    capturedAt: input.capturedAt,
    roadSegment: roadSegmentContext,
    detections: detectionsLite,
    visualQuality: vision.visualQuality,
    candidateRules: rules,
  });

  let incidentId: string;
  let isNewIncident = false;

  if (correlation.incidentId) {
    incidentId = correlation.incidentId;

    // Independent counts (different tables, no shared invariant) — but
    // existingLinks must be captured before the new IncidentObservation row
    // is created below, so the corroboration count reflects links that
    // existed BEFORE this one, not a timing-dependent mix.
    const [existingLinks, recurringCount] = await Promise.all([
      prisma.incidentObservation.count({ where: { incidentId } }),
      roadSegment ? prisma.incident.count({ where: { roadSegmentId: roadSegment.id, incidentType: input.incidentTypeGuess } }) : Promise.resolve(0),
    ]);

    const confidence = computeEvidenceConfidence({
      visualQuality: vision.visualQuality,
      avgDetectionConfidence: avg(vision.detections.map((d) => d.confidence)),
      roadSegmentMatched: !!roadSegment,
      gpsAccuracyMeters: input.gpsAccuracyMeters ?? 12,
      uploadDelaySeconds: input.uploadDelaySeconds ?? 5,
      ruleConfidence: ruleResult.ruleConfidence,
      corroboratingObservationCount: existingLinks,
    });
    const risk = computeRisk({
      incidentType: input.incidentTypeGuess,
      roadSegment: roadSegmentContext,
      capturedAt: input.capturedAt,
      recurringIncidentCountAtLocation: recurringCount,
      avgVisualQuality: vision.visualQuality,
    });

    // Four independent writes (different tables, nothing here reads back
    // what another one just wrote) — safe to fire concurrently.
    const [, updated] = await Promise.all([
      prisma.incidentObservation.create({
        data: {
          incidentId,
          observationId: observation.id,
          correlationScore: correlation.score,
          correlationFactorsJson: JSON.stringify(correlation.factors),
        },
      }),
      prisma.incident.update({
        where: { id: incidentId },
        data: {
          evidenceConfidenceOverall: confidence.overall,
          evidenceConfidenceBreakdown: JSON.stringify(confidence.breakdown),
          riskLevel: risk.level,
          status: confidence.label !== "insufficient" && ruleResult.verdict === "potential_violation" ? "EVIDENCE_VALIDATED" : undefined,
        },
      }),
      prisma.riskScore.create({
        data: { incidentId, factorsJson: JSON.stringify(risk.factors), score: risk.score, level: risk.level },
      }),
      prisma.auditLog.create({
        data: {
          action: "observation.correlated",
          entityType: "incident",
          entityId: incidentId,
          incidentId,
          metadataJson: JSON.stringify({ correlation }),
        },
      }),
    ]);

    eventBus.emit("incident.correlated", { incidentId, observationId: observation.id, score: correlation.score, explanation: correlation.explanation });
    eventBus.emit("incident.updated", { incidentId, status: updated.status, riskLevel: updated.riskLevel, evidenceConfidence: updated.evidenceConfidenceOverall });
  } else {
    isNewIncident = true;

    // Three independent reads — none depends on another's result.
    const [yearCount, recurringCount, authorityResolution] = await Promise.all([
      prisma.incident.count({ where: { createdAt: { gte: new Date(new Date().getFullYear(), 0, 1) } } }),
      roadSegment ? prisma.incident.count({ where: { roadSegmentId: roadSegment.id, incidentType: input.incidentTypeGuess } }) : Promise.resolve(0),
      resolveIncidentAuthority({
        point: { lat: input.lat, lng: input.lng },
        incidentType: input.incidentTypeGuess,
        roadSegmentId: roadSegment?.id ?? null,
      }),
    ]);
    const publicId = formatPublicIncidentId(yearCount + 1);

    const confidence = computeEvidenceConfidence({
      visualQuality: vision.visualQuality,
      avgDetectionConfidence: avg(vision.detections.map((d) => d.confidence)),
      roadSegmentMatched: !!roadSegment,
      gpsAccuracyMeters: input.gpsAccuracyMeters ?? 12,
      uploadDelaySeconds: input.uploadDelaySeconds ?? 5,
      ruleConfidence: ruleResult.ruleConfidence,
      corroboratingObservationCount: 0,
    });
    const risk = computeRisk({
      incidentType: input.incidentTypeGuess,
      roadSegment: roadSegmentContext,
      capturedAt: input.capturedAt,
      recurringIncidentCountAtLocation: recurringCount,
      avgVisualQuality: vision.visualQuality,
    });

    const status = confidence.label !== "insufficient" && ruleResult.verdict === "potential_violation" ? "EVIDENCE_VALIDATED" : "OBSERVED";

    const incident = await prisma.incident.create({
      data: {
        publicId,
        incidentType: input.incidentTypeGuess,
        status,
        riskLevel: risk.level,
        evidenceConfidenceOverall: confidence.overall,
        evidenceConfidenceBreakdown: JSON.stringify(confidence.breakdown),
        ruleId: ruleResult.matchedRule?.id ?? null,
        ruleVerdict: ruleResult.verdict,
        ruleReasoning: ruleResult.reasoning,
        locationId: location.id,
        roadSegmentId: roadSegment?.id ?? null,
        authorityId: authorityResolution.authorityId,
      },
    });
    incidentId = incident.id;

    // Four independent writes (different tables, nothing here reads back
    // what another one just wrote) — safe to fire concurrently.
    await Promise.all([
      prisma.incidentObservation.create({
        data: {
          incidentId,
          observationId: observation.id,
          correlationScore: 1,
          correlationFactorsJson: JSON.stringify({ temporal: 1, spatial: 1, trajectory: 1, scene: 1, appearance: 1, incidentTypeMatch: 1 }),
        },
      }),
      prisma.riskScore.create({
        data: { incidentId, factorsJson: JSON.stringify(risk.factors), score: risk.score, level: risk.level },
      }),
      prisma.auditLog.create({
        data: {
          action: "incident.created",
          entityType: "incident",
          entityId: incidentId,
          incidentId,
          metadataJson: JSON.stringify({ ruleResult, authorityResolution }),
        },
      }),
      input.userId
        ? prisma.notification.create({
            data: {
              userId: input.userId,
              type: "incident_created",
              title: "Report processed",
              body: `Your observation was processed as incident ${publicId} (${ruleResult.verdict.replaceAll("_", " ")}).`,
              incidentId,
            },
          })
        : Promise.resolve(null),
    ]);

    eventBus.emit("incident.created", { incidentId, publicId, incidentType: input.incidentTypeGuess, riskLevel: risk.level, lat: input.lat, lng: input.lng });
  }

  if (roadSegment) {
    const hotspot = await refreshHotspot(roadSegment.id, input.incidentTypeGuess);
    eventBus.emit("hotspot.updated", { hotspotId: hotspot.hotspotId, isRecurring: hotspot.isRecurring, roadSegmentId: roadSegment.id });
  }

  return { observationId: observation.id, incidentId, isNewIncident, ruleResult, correlation, evidence };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
