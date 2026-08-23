// ---------------------------------------------------------------------------
// DEMO STREAM — a clearly-labeled local simulation that periodically feeds
// new observations through the real pipeline (vision -> correlate -> rule ->
// confidence -> risk -> route -> hotspot) so the dashboard/map can be seen
// updating in real time without a live government sensor feed. Every event
// this produces is tagged demo: true end to end (see lib/realtime/bus.ts and
// the "DEMO" badge in the UI) — it is never presented as real-world data.
// Controlled by ENABLE_DEMO_STREAM in .env; disabled entirely otherwise.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";
import { createObservation } from "@/lib/services/observationPipeline";
import { INCIDENT_TYPES } from "@/lib/types";
import { eventBus } from "@/lib/realtime/bus";

const TICK_INTERVAL_MS = 35_000;

const globalForStream = globalThis as unknown as { civiquexStreamStarted?: boolean };

function randomHash(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function tick() {
  try {
    const segments = await prisma.roadSegment.findMany();
    if (segments.length === 0) return;

    const segment = segments[Math.floor(Math.random() * segments.length)];
    const line = JSON.parse(segment.geometryJson) as [number, number][];
    const point = line[Math.floor(Math.random() * line.length)];
    const type = INCIDENT_TYPES[Math.floor(Math.random() * INCIDENT_TYPES.length)];
    const sources = ["CITIZEN", "DASHCAM", "AUTHORIZED_SENSOR"] as const;

    await createObservation({
      sourceType: sources[Math.floor(Math.random() * sources.length)],
      observerHash: `demo-observer-${randomHash().slice(0, 10)}`,
      incidentTypeGuess: type.code,
      capturedAt: new Date(),
      lat: point[1] + (Math.random() - 0.5) * 0.0006,
      lng: point[0] + (Math.random() - 0.5) * 0.0006,
      orientationDeg: Math.floor(Math.random() * 360),
      mediaKind: "video",
      mediaRef: `demo-stream-${randomHash()}`,
      gpsAccuracyMeters: 6 + Math.random() * 20,
      uploadDelaySeconds: Math.random() * 60,
    });

    eventBus.emit("demo.tick", { at: new Date().toISOString() }, true);
  } catch (err) {
    // A failed simulated tick must never take down the app.
    console.error("[demo-stream] tick failed", err);
  }
}

export function ensureDemoStreamRunning() {
  if (globalForStream.civiquexStreamStarted) return;
  if (process.env.ENABLE_DEMO_STREAM !== "true") return;
  if (process.env.DATA_MODE === "live") return; // never mixes with a live data mode

  globalForStream.civiquexStreamStarted = true;
  setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
}
