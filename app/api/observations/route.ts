import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, fail, withApiHandler } from "@/lib/api/respond";
import { createObservation } from "@/lib/services/observationPipeline";
import { recordDirectUpload, saveBase64Media } from "@/lib/api/media";
import { INCIDENT_TYPES } from "@/lib/types";
import type { Detection, VisionResult } from "@/lib/ai/vision";

const MAX_FILE_BYTES = 60 * 1024 * 1024; // 60MB
const ALLOWED_TYPES = ["video/webm", "video/mp4", "image/jpeg", "image/png", "image/webp"];

const detectionSummarySchema = z.object({
  objectDetections: z.array(
    z.object({ label: z.string(), confidence: z.number().min(0).max(1), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]) })
  ),
  anomalyScore: z.number().min(0).max(1),
  anomalyBbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
  objectModel: z.string(),
  anomalyModel: z.string(),
});

const bodySchema = z.object({
  incidentTypeGuess: z.enum(INCIDENT_TYPES.map((t) => t.code) as [string, ...string[]]),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  capturedAt: z.coerce.date(),
  orientationDeg: z.coerce.number().min(0).max(360).optional(),
  gpsAccuracyMeters: z.coerce.number().min(0).max(500).optional(),
  // Small captures still ride along as base64 JSON. Anything too large for
  // that (video, in particular — see lib/client/uploadMedia.ts) instead
  // uploads directly from the browser to Blob first, and only its URL +
  // content hash land here.
  mediaBase64: z.string().min(1).optional(),
  mediaBlobUrl: z.string().url().optional(),
  mediaContentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  mediaType: z.enum(ALLOWED_TYPES as [string, ...string[]]),
  // Real, client-side TensorFlow.js (COCO-SSD) + Sobel road-anomaly detection,
  // run on the actual captured frame — see useRoadPatrolDetector. When
  // present, this replaces the deterministic demo vision stub so the AI
  // pipeline reasons about what's genuinely in the photo/video, not just the
  // incident type the citizen picked.
  detectionSummary: detectionSummarySchema.optional(),
});

// Same construction the AI Road Patrol confirm route uses for its real
// detections (see app/api/patrol/detections/[id]/confirm/route.ts) — every
// number here is derived from an actual model output, never randomized.
function buildVisionResult(summary: z.infer<typeof detectionSummarySchema>, inputRef: string, capturedAt: Date): VisionResult {
  const detections: Detection[] = [
    ...summary.objectDetections,
    { label: "road_surface_anomaly", confidence: summary.anomalyScore, bbox: summary.anomalyBbox ?? [0.4, 0.4, 0.2, 0.2] },
  ];

  const sceneDescriptor = [
    summary.anomalyScore,
    Math.min(1, summary.objectDetections.length / 10),
    ...summary.objectDetections.slice(0, 13).map((d) => d.confidence),
  ];
  while (sceneDescriptor.length < 16) sceneDescriptor.push(0);

  const topObjectConfidence = summary.objectDetections.length > 0 ? Math.max(...summary.objectDetections.map((d) => d.confidence)) : null;
  // Nothing relevant detected and no road-surface anomaly either: this is
  // real, low-quality evidence (e.g. a wall, an empty frame) — it must read
  // as low quality, not be quietly propped up to a passing score.
  const visualQuality =
    topObjectConfidence != null ? Math.min(0.95, 0.5 + topObjectConfidence * 0.4) : summary.anomalyScore > 0.6 ? Math.min(0.9, summary.anomalyScore) : 0.2;

  const objectSummary = summary.objectDetections.length > 0 ? summary.objectDetections.map((d) => d.label).join(", ") : "no recognizable object";

  return {
    model: summary.objectModel,
    modelVersion: summary.anomalyModel,
    inputRef,
    generatedAt: capturedAt.toISOString(),
    detections,
    sceneDescriptor,
    visualQuality,
    explanation: `Real client-side detection: ${objectSummary} (${summary.objectModel}); road-surface anomaly score ${(summary.anomalyScore * 100).toFixed(0)}% (${summary.anomalyModel}).`,
  };
}

export const POST = withApiHandler(async (req: Request) => {
  const session = await requireSession();
  const body = bodySchema.parse(await req.json());

  let media;
  try {
    if (body.mediaBlobUrl && body.mediaContentHash) {
      media = await recordDirectUpload(body.mediaBlobUrl, body.mediaContentHash);
    } else if (body.mediaBase64) {
      media = await saveBase64Media(body.mediaBase64, body.mediaType, MAX_FILE_BYTES);
    } else {
      return fail("No media payload provided", 422);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Invalid media payload", 422);
  }

  const observerHash = crypto.createHash("sha256").update(`${session.id}:civiquex-observer-salt`).digest("hex").slice(0, 20);
  const uploadDelaySeconds = Math.max(0, (Date.now() - body.capturedAt.getTime()) / 1000);

  const result = await createObservation({
    userId: session.id,
    sourceType: "CITIZEN",
    observerHash,
    incidentTypeGuess: body.incidentTypeGuess,
    capturedAt: body.capturedAt,
    lat: body.lat,
    lng: body.lng,
    orientationDeg: body.orientationDeg ?? null,
    mediaKind: media.kind,
    mediaRef: media.hash,
    storageRef: media.storageRef,
    blobUrl: media.blobUrl,
    gpsAccuracyMeters: body.gpsAccuracyMeters,
    uploadDelaySeconds,
    visionOverride: body.detectionSummary ? buildVisionResult(body.detectionSummary, media.hash, body.capturedAt) : undefined,
  });

  return ok(result, 201);
});

const listSchema = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
  incidentType: z.string().optional(),
});

export const GET = withApiHandler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const query = listSchema.parse(Object.fromEntries(searchParams));

  const observations = await prisma.observation.findMany({
    where: query.incidentType ? { incidentTypeGuess: query.incidentType } : undefined,
    orderBy: { capturedAt: "desc" },
    take: query.limit,
    include: { incidentLinks: { select: { incidentId: true } } },
  });

  return ok(
    observations.map((o) => ({
      id: o.id,
      sourceType: o.sourceType,
      incidentTypeGuess: o.incidentTypeGuess,
      capturedAt: o.capturedAt,
      lat: o.lat,
      lng: o.lng,
      status: o.status,
      incidentIds: o.incidentLinks.map((l) => l.incidentId),
    }))
  );
});
