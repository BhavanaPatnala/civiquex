"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

export const CityMapDynamic = dynamic(() => import("@/components/domain/city-map").then((m) => m.CityMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-border bg-muted/40">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  ),
});

export type { MapIncidentPoint, MapHotspotPoint } from "@/components/domain/city-map";
