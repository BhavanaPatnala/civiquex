import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, fail, withApiHandler } from "@/lib/api/respond";
import { createObservation } from "@/lib/services/observationPipeline";
import type { Detection, VisionResult } from "@/lib/ai/vision";

// Turns a flagged AI Road Patrol candidate into a real Observation/Incident
// via the standard pipeline, feeding it the REAL client-side detections
// (see useRoadPatrolDetector) instead of the demo vision stub — every
// downstream engine (rule, confidence, correlation, risk, routing) then
// runs on genuine AI output for this incident.
export const POST = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const session = await requireSession();

  const detection = await prisma.patrolDetection.findUnique({
    where: { id: params.id },
    relationLoadStrategy: "join",
    include: { media: true, contract: true },
  });
  if (!detection) return fail("Patrol detection not found", 404);
  if (detection.status !== "candidate") return fail(`Already ${detection.status}`, 409);

  const summary = JSON.parse(detection.detectionSummaryJson) as {
    objectDetections: { label: string; confidence: number; bbox: [number, number, number, number] }[];
    anomalyScore: number;
    anomalyBbox: [number, number, number, number] | null;
    objectModel: string;
    anomalyModel: string;
  };

  const detections: Detection[] = [
    ...summary.objectDetections,
    {
      label: "road_surface_anomaly",
      confidence: summary.anomalyScore,
      bbox: summary.anomalyBbox ?? [0.4, 0.4, 0.2, 0.2],
    },
  ];

  // A real, derived (not random) 16-dim descriptor: anomaly score, timing,
  // frame count, and up to 13 real per-object confidences, zero-padded.
  const sceneDescriptor = [
    summary.anomalyScore,
    Math.min(1, (summary.objectDetections.length ?? 0) / 10),
    ...summary.objectDetections.slice(0, 13).map((d) => d.confidence),
  ];
  while (sceneDescriptor.length < 16) sceneDescriptor.push(0);

  const topObjectConfidence = summary.objectDetections.length > 0 ? Math.max(...summary.objectDetections.map((d) => d.confidence)) : null;
  const visualQuality = topObjectConfidence != null ? Math.min(0.95, 0.5 + topObjectConfidence * 0.4) : 0.55;

  const vision: VisionResult = {
    model: summary.objectModel,
    modelVersion: summary.anomalyModel,
    inputRef: detection.media?.contentHash ?? detection.id,
    generatedAt: detection.capturedAt.toISOString(),
    detections,
    sceneDescriptor,
    visualQuality,
    explanation: `Real-time AI Road Patrol: ${summary.objectDetections.length} object(s) detected by ${summary.objectModel}; road-surface anomaly score ${(summary.anomalyScore * 100).toFixed(0)}% from ${summary.anomalyModel}.`,
  };

  const result = await createObservation({
    userId: session.id,
    sourceType: "DASHCAM",
    observerHash: session.id,
    incidentTypeGuess: "pothole_damage",
    capturedAt: detection.capturedAt,
    lat: detection.lat,
    lng: detection.lng,
    mediaKind: "image",
    mediaRef: detection.media?.contentHash ?? detection.id,
    storageRef: detection.media?.storageRef,
    blobUrl: detection.media?.blobUrl,
    gpsAccuracyMeters: detection.gpsAccuracyMeters ?? undefined,
    uploadDelaySeconds: Math.max(0, (Date.now() - detection.capturedAt.getTime()) / 1000),
    visionOverride: vision,
  });

  await prisma.patrolDetection.update({
    where: { id: detection.id },
    data: { status: "confirmed", observationId: result.observationId },
  });

  if (detection.contract) {
    await prisma.auditLog.create({
      data: {
        actorId: session.id,
        action: "contract.matched",
        entityType: "incident",
        entityId: result.incidentId,
        incidentId: result.incidentId,
        metadataJson: JSON.stringify({
          tenderNo: detection.contract.tenderNo,
          contractorName: detection.contract.contractorName,
          contractorEmail: detection.contract.contractorEmail,
          officerName: detection.contract.officerName,
          officerEmail: detection.contract.officerEmail,
          score: detection.matchScore,
          matchedBy: detection.matchedByJson ? JSON.parse(detection.matchedByJson) : [],
          activeWarranty: detection.activeWarranty,
        }),
      },
    });
  }

  return ok({ incidentId: result.incidentId, observationId: result.observationId });
});
