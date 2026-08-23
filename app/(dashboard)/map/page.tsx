"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CityMapDynamic, type MapIncidentPoint, type MapHotspotPoint } from "@/components/domain/city-map-dynamic";
import { apiGet } from "@/lib/client/api";
import { INCIDENT_TYPES } from "@/lib/types";

interface RiskMapResponse {
  incidents: MapIncidentPoint[];
  hotspots: MapHotspotPoint[];
}

export default function LiveMapPage() {
  const router = useRouter();
  const [data, setData] = useState<RiskMapResponse | null>(null);
  const [incidentType, setIncidentType] = useState("all");
  const [riskLevel, setRiskLevel] = useState("all");
  const [status, setStatus] = useState("all");
  const [heatmap, setHeatmap] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (incidentType !== "all") params.set("incidentType", incidentType);
    if (riskLevel !== "all") params.set("riskLevel", riskLevel);
    if (status !== "all") params.set("status", status);
    apiGet<RiskMapResponse>(`/api/risk-map?${params}`).then(setData).catch(() => setData(null));
  }, [incidentType, riskLevel, status]);

  return (
    <>
      <PageHeader title="Live Incident Map" description="Clustering, heatmap, and multi-dimensional filtering across the demo zone" />
      <PageContainer className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={incidentType} onValueChange={setIncidentType}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Incident type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All incident types</SelectItem>
              {INCIDENT_TYPES.map((t) => (
                <SelectItem key={t.code} value={t.code}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={riskLevel} onValueChange={setRiskLevel}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Risk level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk levels</SelectItem>
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["OBSERVED", "EVIDENCE_VALIDATED", "SUBMITTED", "RESOLVED", "STILL_PRESENT", "REOPENED"].map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="heatmap" className="text-xs">
              Hotspot heatmap
            </Label>
            <Switch id="heatmap" checked={heatmap} onCheckedChange={setHeatmap} />
          </div>
        </div>

        <Card className="overflow-hidden p-0">
          <div className="h-[calc(100vh-260px)] min-h-[420px]">
            {data && (
              <CityMapDynamic
                incidents={data.incidents}
                hotspots={data.hotspots}
                showHeatmap={heatmap}
                onIncidentClick={(id) => router.push(`/incidents/${id}`)}
                className="h-full w-full"
              />
            )}
          </div>
        </Card>
        <p className="text-[11px] text-muted-foreground">{data?.incidents.length ?? 0} incidents shown · Map tiles © OpenStreetMap contributors</p>
      </PageContainer>
    </>
  );
}
