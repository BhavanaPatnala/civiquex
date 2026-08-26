import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, fail, withApiHandler } from "@/lib/api/respond";
import { reverseGeocode } from "@/lib/services/geocode";
import { findContractMatch } from "@/lib/services/contractService";
import { recordDirectUpload, saveBase64Media } from "@/lib/api/media";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

const detectionSummarySchema = z.object({
  objectDetections: z.array(z.object({ label: z.string(), confidence: z.number(), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]) })),
  anomalyScore: z.number().min(0).max(1),
  anomalyBbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  inferenceMs: z.number(),
  objectModel: z.string(),
  anomalyModel: z.string(),
  framesAnalyzed: z.number(),
});

const bodySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  gpsAccuracyMeters: z.coerce.number().min(0).max(500).optional(),
  capturedAt: z.coerce.date(),
  notes: z.string().max(500).optional(),
  mediaBase64: z.string().min(1).optional(),
  mediaBlobUrl: z.string().url().optional(),
  mediaContentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  detectionSummary: detectionSummarySchema,
});

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

  const evidence = await prisma.evidence.create({
    data: {
      kind: "image",
      storageRef: media.storageRef,
      blobUrl: media.blobUrl,
      facesBlurred: true,
      encrypted: true,
      contentHash: media.hash,
      retentionUntil: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    },
  });

  const [geocoded, contractMatch] = await Promise.all([
    reverseGeocode(body.lat, body.lng),
    findContractMatch({ lat: body.lat, lng: body.lng }, body.notes),
  ]);

  const detection = await prisma.patrolDetection.create({
    data: {
      userId: session.id,
      lat: body.lat,
      lng: body.lng,
      gpsAccuracyMeters: body.gpsAccuracyMeters,
      capturedAt: body.capturedAt,
      roadName: geocoded?.road ?? geocoded?.displayName.split(",")[0] ?? null,
      detectionModel: `${body.detectionSummary.objectModel} + ${body.detectionSummary.anomalyModel}`,
      detectionSummaryJson: JSON.stringify(body.detectionSummary),
      mediaId: evidence.id,
      contractId: contractMatch?.contract.id ?? null,
      matchScore: contractMatch?.score ?? null,
      matchedByJson: contractMatch ? JSON.stringify(contractMatch.matchedBy) : null,
      activeWarranty: contractMatch?.activeWarranty ?? false,
      status: "candidate",
    },
  });

  return ok(
    {
      id: detection.id,
      lat: detection.lat,
      lng: detection.lng,
      roadName: detection.roadName,
      geocodeSource: geocoded?.source ?? null,
      capturedAt: detection.capturedAt,
      mediaUrl: evidence.storageRef,
      detectionSummary: body.detectionSummary,
      contractMatch: contractMatch
        ? {
            tenderNo: contractMatch.contract.tenderNo,
            contractorName: contractMatch.contract.contractorName,
            contractorEmail: contractMatch.contract.contractorEmail,
            officerName: contractMatch.contract.officerName,
            officerEmail: contractMatch.contract.officerEmail,
            roadName: contractMatch.contract.roadName,
            score: contractMatch.score,
            matchedBy: contractMatch.matchedBy,
            activeWarranty: contractMatch.activeWarranty,
          }
        : null,
    },
    201
  );
});

const listSchema = z.object({ limit: z.coerce.number().min(1).max(100).default(20) });

export const GET = withApiHandler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const q = listSchema.parse(Object.fromEntries(searchParams));

  const detections = await prisma.patrolDetection.findMany({
    orderBy: { createdAt: "desc" },
    take: q.limit,
    relationLoadStrategy: "join",
    include: { contract: true, media: true },
  });

  return ok(
    detections.map((d) => ({
      id: d.id,
      lat: d.lat,
      lng: d.lng,
      roadName: d.roadName,
      capturedAt: d.capturedAt,
      status: d.status,
      matchScore: d.matchScore,
      activeWarranty: d.activeWarranty,
      contract: d.contract ? { tenderNo: d.contract.tenderNo, contractorName: d.contract.contractorName, roadName: d.contract.roadName } : null,
      mediaUrl: d.media?.storageRef ?? null,
      observationId: d.observationId,
    }))
  );
});
