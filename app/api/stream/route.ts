import { eventBus } from "@/lib/realtime/bus";
import { ensureDemoStreamRunning } from "@/lib/services/demoStream";

export const dynamic = "force-dynamic";

// Server-Sent Events endpoint — the single-stack stand-in for a WebSocket
// server. Every dashboard/map view subscribes here for live incident,
// correlation, risk, resolution, and hotspot updates.
export async function GET() {
  ensureDemoStreamRunning();

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: NodeJS.Timeout;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("connected", { at: new Date().toISOString() });

      unsubscribe = eventBus.subscribe((evt) => {
        try {
          send(evt.type, evt);
        } catch {
          // Controller may already be closed if the client disconnected.
        }
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 20000);
    },
    cancel() {
      unsubscribe();
      clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
