"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Flame, School, Hospital } from "lucide-react";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/domain/risk-badge";
import { StatusBadge } from "@/components/domain/status-badge";
import { apiGet } from "@/lib/client/api";
import { formatDateTime, titleCase } from "@/lib/utils";

interface HotspotRow {
  id: string;
  incidentType: string;
  incidentCount: number;
  recurringCount: number;
  avgDurationMinutes: number | null;
  riskLevel: string;
  firstSeenAt: string;
  lastSeenAt: string;
  roadSegment: { id: string; name: string; schoolNearby: boolean; hospitalNearby: boolean } | null;
  location: { lat: number; lng: number } | null;
  recentIncidents: { id: string; publicId: string; status: string; riskLevel: string; createdAt: string }[];
}

export default function HotspotsPage() {
  return (
    <Suspense fallback={null}>
      <HotspotsPageInner />
    </Suspense>
  );
}

function HotspotsPageInner() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("id");
  const [hotspots, setHotspots] = useState<HotspotRow[] | null>(null);

  useEffect(() => {
    apiGet<HotspotRow[]>("/api/hotspots?recurringOnly=true").then(setHotspots).catch(() => setHotspots([]));
  }, []);

  return (
    <>
      <PageHeader title="Hotspot Intelligence" description="Recurring safety hotspots — repeated incidents treated as one location-level risk, not independent complaints" />
      <PageContainer>
        {hotspots === null ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56" />
            ))}
          </div>
        ) : hotspots.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-20 text-center">
            <Flame className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">No recurring hotspots yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              A location becomes a hotspot once the same incident type recurs there at least 3 times within a 90-day window.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {hotspots.map((h) => (
              <Card key={h.id} className={h.id === highlightId ? "ring-2 ring-primary" : undefined}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-1.5">
                        <Flame className="h-3.5 w-3.5 text-warning" />
                        {h.roadSegment?.name ?? "Unmatched location"}
                      </CardTitle>
                      <p className="mt-0.5 text-xs text-muted-foreground">{titleCase(h.incidentType)}</p>
                    </div>
                    <RiskBadge level={h.riskLevel} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-muted p-2">
                      <div className="text-lg font-semibold tabular-nums">{h.incidentCount}</div>
                      <div className="text-[10px] text-muted-foreground">Incidents</div>
                    </div>
                    <div className="rounded-md bg-muted p-2">
                      <div className="text-lg font-semibold tabular-nums">{h.recurringCount}</div>
                      <div className="text-[10px] text-muted-foreground">Recurring</div>
                    </div>
                    <div className="rounded-md bg-muted p-2">
                      <div className="text-lg font-semibold tabular-nums">{h.avgDurationMinutes != null ? `${Math.round(h.avgDurationMinutes / 60)}h` : "—"}</div>
                      <div className="text-[10px] text-muted-foreground">Avg. duration</div>
                    </div>
                  </div>

                  {(h.roadSegment?.schoolNearby || h.roadSegment?.hospitalNearby) && (
                    <div className="flex flex-wrap gap-1.5">
                      {h.roadSegment?.schoolNearby && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <School className="h-3 w-3" /> School zone
                        </Badge>
                      )}
                      {h.roadSegment?.hospitalNearby && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Hospital className="h-3 w-3" /> Hospital nearby
                        </Badge>
                      )}
                    </div>
                  )}

                  <div>
                    <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Recent incidents</p>
                    <div className="flex flex-col gap-1">
                      {h.recentIncidents.map((inc) => (
                        <Link
                          key={inc.id}
                          href={`/incidents/${inc.id}`}
                          className="flex items-center justify-between rounded-md px-1.5 py-1 text-xs hover:bg-accent"
                        >
                          <span className="text-primary">{inc.publicId}</span>
                          <span className="flex items-center gap-1.5">
                            <StatusBadge status={inc.status} className="text-[9px]" />
                            <span className="text-muted-foreground">{formatDateTime(inc.createdAt)}</span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    First seen {formatDateTime(h.firstSeenAt)} · Last seen {formatDateTime(h.lastSeenAt)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageContainer>
    </>
  );
}
