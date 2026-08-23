"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2, MapPinOff, RotateCcw } from "lucide-react";

const LOAD_TIMEOUT_MS = 10_000;

export interface MapIncidentPoint {
  id: string;
  publicId: string;
  lat: number;
  lng: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: string;
  incidentType: string;
}

export interface MapHotspotPoint {
  id: string;
  lat: number;
  lng: number;
  incidentCount: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  incidentType: string;
  roadSegmentName: string | null;
}

const RISK_COLOR: Record<string, string> = {
  LOW: "#64748b",
  MEDIUM: "#d97706",
  HIGH: "#ea580c",
  CRITICAL: "#dc2626",
};

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "© OpenStreetMap contributors";

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  // Public MapLibre demo glyphs — required for any layer using text-field
  // (the cluster-count labels below). No API key needed.
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: [TILE_URL],
      tileSize: 256,
      attribution: ATTRIBUTION,
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const CHENNAI_CENTER: [number, number] = [80.245, 13.02];

export function CityMap({
  incidents,
  hotspots = [],
  showHeatmap = false,
  onIncidentClick,
  onHotspotClick,
  className,
}: {
  incidents: MapIncidentPoint[];
  hotspots?: MapHotspotPoint[];
  showHeatmap?: boolean;
  onIncidentClick?: (id: string) => void;
  onHotspotClick?: (id: string) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    setReady(false);
    setTimedOut(false);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: CHENNAI_CENTER,
      zoom: 11.5,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    // A map that never fires "load" (a blocked tile host, a dead network,
    // a WebGL context that failed to init) must never leave the user
    // staring at a spinner forever with no way out.
    const timeoutId = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);

    map.on("load", () => {
      clearTimeout(timeoutId);
      map.addSource("incidents", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 42,
        clusterMaxZoom: 15,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "incidents",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#1d4ed8",
          "circle-opacity": 0.85,
          "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 30, 26],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "incidents",
        filter: ["has", "point_count"],
        layout: { "text-field": "{point_count_abbreviated}", "text-size": 12, "text-font": ["Noto Sans Bold"] },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "incident-points",
        type: "circle",
        source: "incidents",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 7,
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addSource("hotspots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "hotspot-heat",
        type: "circle",
        source: "hotspots",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "incidentCount"], 3, 18, 40, 55],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.22,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": ["get", "color"],
        },
        layout: { visibility: "none" },
      });

      map.on("click", "incident-points", (e) => {
        const f = e.features?.[0];
        if (f?.properties?.id) onIncidentClick?.(f.properties.id as string);
      });
      map.on("click", "clusters", (e) => {
        const f = e.features?.[0];
        const clusterId = f?.properties?.cluster_id;
        const source = map.getSource("incidents") as GeoJSONSource;
        if (clusterId != null) {
          source.getClusterExpansionZoom(clusterId).then((zoom) => {
            map.easeTo({ center: (f!.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
          });
        }
      });
      map.on("click", "hotspot-heat", (e) => {
        const f = e.features?.[0];
        if (f?.properties?.id) onHotspotClick?.(f.properties.id as string);
      });
      for (const layer of ["incident-points", "clusters", "hotspot-heat"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }

      setReady(true);
    });

    mapRef.current = map;
    return () => {
      clearTimeout(timeoutId);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("incidents") as GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: incidents.map((i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [i.lng, i.lat] },
        properties: { id: i.id, color: RISK_COLOR[i.riskLevel] ?? RISK_COLOR.LOW, publicId: i.publicId },
      })),
    });
  }, [incidents, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("hotspots") as GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: hotspots.map((h) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [h.lng, h.lat] },
        properties: { id: h.id, incidentCount: h.incidentCount, color: RISK_COLOR[h.riskLevel] ?? RISK_COLOR.MEDIUM },
      })),
    });
    map.setLayoutProperty("hotspot-heat", "visibility", showHeatmap ? "visible" : "none");
  }, [hotspots, ready, showHeatmap]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <div ref={containerRef} className="h-full w-full rounded-lg" />
      {!ready && !timedOut && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-muted/60">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Loading map…</span>
        </div>
      )}
      {!ready && timedOut && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/60 px-4 text-center">
          <MapPinOff className="h-5 w-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">The map couldn&apos;t load — this is usually a slow or blocked connection to the map tile server.</p>
          <button
            type="button"
            onClick={() => setRetryKey((k) => k + 1)}
            className="mt-1 flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
          >
            <RotateCcw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}
    </div>
  );
}
