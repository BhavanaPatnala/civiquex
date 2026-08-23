"use client";

import { useCallback, useState } from "react";

export type GeoStatus = "idle" | "locating" | "granted" | "denied" | "unavailable";

export function useGeolocation() {
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);

  const request = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setStatus("granted");
      },
      () => setStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const setManual = useCallback((lat: number, lng: number) => {
    setCoords({ lat, lng, accuracy: 30 });
    setStatus("granted");
  }, []);

  return { status, coords, request, setManual };
}
