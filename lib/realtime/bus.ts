// ---------------------------------------------------------------------------
// In-process realtime event bus, broadcast over Server-Sent Events at
// /api/stream. This is the single-stack stand-in for a WebSocket/Redis
// pub-sub layer: new observation -> pipeline processes it -> incident
// updates -> this bus fans the event out -> the dashboard/map update without
// a page refresh. Swapping to Redis pub-sub for multi-instance deployment
// only means replacing this module's internals; consumers (route handlers,
// client hooks) are unaffected.
// ---------------------------------------------------------------------------

export type RealtimeEventType =
  | "observation.created"
  | "incident.created"
  | "incident.updated"
  | "incident.correlated"
  | "risk.updated"
  | "resolution.checked"
  | "hotspot.updated"
  | "notification.created"
  | "demo.tick";

export interface RealtimeEvent {
  type: RealtimeEventType;
  at: string;
  payload: unknown;
  demo: boolean;
}

type Listener = (event: RealtimeEvent) => void;

class EventBus {
  private listeners = new Set<Listener>();
  private recent: RealtimeEvent[] = [];
  private readonly maxRecent = 50;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type: RealtimeEventType, payload: unknown, demo = true) {
    const event: RealtimeEvent = { type, at: new Date().toISOString(), payload, demo };
    this.recent.push(event);
    if (this.recent.length > this.maxRecent) this.recent.shift();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A slow/broken subscriber should never break the pipeline that emitted the event.
      }
    }
  }

  getRecent(): RealtimeEvent[] {
    return [...this.recent];
  }
}

const globalForBus = globalThis as unknown as { civiquexBus?: EventBus };
export const eventBus = globalForBus.civiquexBus ?? new EventBus();
if (process.env.NODE_ENV !== "production") globalForBus.civiquexBus = eventBus;
