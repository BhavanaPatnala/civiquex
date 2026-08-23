"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent, RealtimeEventType } from "@/lib/realtime/bus";

/**
 * Subscribes to /api/stream (SSE) and calls onEvent for every event of the
 * given type(s). Auto-reconnects on drop. Returns a small connection-state
 * flag so the UI can show "live" vs "reconnecting".
 */
export function useRealtime(types: RealtimeEventType[], onEvent: (event: RealtimeEvent) => void) {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      es = new EventSource("/api/stream");
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!cancelled) reconnectTimer = setTimeout(connect, 4000);
      };
      for (const type of types) {
        es.addEventListener(type, (evt) => {
          try {
            onEventRef.current(JSON.parse((evt as MessageEvent).data));
          } catch {
            // ignore malformed event
          }
        });
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types.join(",")]);

  return { connected };
}
