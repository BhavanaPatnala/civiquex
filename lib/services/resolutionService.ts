import { prisma } from "@/lib/db";
import { checkResolution } from "@/lib/engines/resolution";
import { eventBus } from "@/lib/realtime/bus";
import type { DetectionLike } from "@/lib/types";

const OFFENDING_LABELS = ["parked_vehicle", "obstruction_object", "damaged_sign", "obscured_sign"];

/**
 * Runs an independent resolution check for an incident: compares the
 * original ("before") observation against the most recent observation at
 * the same location captured after the authority reported action. Never
 * trusts the authority's self-reported status — always re-derives state
 * from evidence.
 */
export async function runResolutionCheck(incidentId: string) {
  const incident = await prisma.incident.findUniqueOrThrow({
    where: { id: incidentId },
    include: {
      observations: { include: { observation: true }, orderBy: { addedAt: "asc" } },
    },
  });

  const beforeObservation = incident.observations[0]?.observation;
  if (!beforeObservation) throw new Error("Incident has no observations to compare against");

  // "After" candidate: the most recent observation on this incident's road
  // segment, of the same incident type, captured strictly after the
  // ORIGINAL ("before") observation's real-world capture time — i.e. a
  // fresh independent look at the same spot. Anchored to capturedAt, not
  // the DB insert timestamp, so this also works correctly for backfilled
  // history and delayed uploads.
  const afterObservation = incident.roadSegmentId
    ? await prisma.observation.findFirst({
        where: {
          roadSegmentId: incident.roadSegmentId,
          incidentTypeGuess: incident.incidentType,
          capturedAt: { gt: beforeObservation.capturedAt },
          NOT: { id: beforeObservation.id },
        },
        orderBy: { capturedAt: "desc" },
      })
    : null;

  const beforeDetections: DetectionLike[] = JSON.parse(beforeObservation.objectDetectionsJson);
  const beforeScene: number[] = JSON.parse(beforeObservation.sceneDescriptorJson);
  const afterDetections: DetectionLike[] | null = afterObservation ? JSON.parse(afterObservation.objectDetectionsJson) : null;
  const afterScene: number[] | null = afterObservation ? JSON.parse(afterObservation.sceneDescriptorJson) : null;

  const result = checkResolution({
    beforeDetections,
    afterDetections,
    beforeSceneDescriptor: beforeScene,
    afterSceneDescriptor: afterScene,
    offendingLabels: OFFENDING_LABELS.filter((l) => beforeDetections.some((d) => d.label === l)),
  });

  const check = await prisma.resolutionCheck.create({
    data: {
      incidentId,
      beforeObservationId: beforeObservation.id,
      afterObservationId: afterObservation?.id ?? null,
      similarityScore: result.similarityScore,
      objectPresenceDeltaJson: JSON.stringify(result.objectPresenceDelta),
      result: result.result,
      confidence: result.confidence,
    },
  });

  let newStatus = incident.status;
  if (result.result === "likely_resolved" && result.confidence >= 0.7) {
    newStatus = "RESOLVED";
  } else if (result.result === "still_present") {
    newStatus = incident.status === "ACTION_REPORTED" || incident.status === "AUTHORITY_ACKNOWLEDGED" ? "REOPENED" : "STILL_PRESENT";
  } else {
    newStatus = "INDEPENDENT_VERIFICATION";
  }

  await prisma.incident.update({ where: { id: incidentId }, data: { status: newStatus } });

  await prisma.auditLog.create({
    data: {
      action: "resolution.checked",
      entityType: "incident",
      entityId: incidentId,
      incidentId,
      metadataJson: JSON.stringify({ result: result.result, confidence: result.confidence, newStatus }),
    },
  });

  eventBus.emit("resolution.checked", { incidentId, result: result.result, confidence: result.confidence, status: newStatus });
  eventBus.emit("incident.updated", { incidentId, status: newStatus });

  return { check, result, newStatus };
}
