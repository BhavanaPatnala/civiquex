"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip as RTooltip, CartesianGrid, Cell } from "recharts";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/domain/stat-tile";
import { CheckCircle2, Clock, Gauge, ListChecks } from "lucide-react";
import { apiGet } from "@/lib/client/api";
import { formatPercent, titleCase } from "@/lib/utils";

interface Analytics {
  totalIncidents: number;
  resolvedIncidents: number;
  resolutionRate: number | null;
  avgResolutionMinutes: number | null;
  avgEvidenceConfidence: number | null;
  byIncidentType: { incidentType: string; count: number }[];
}

const COLORS = ["#1d4ed8", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#0ea5e9", "#06b6d4", "#0891b2", "#0e7490"];

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    apiGet<Analytics>("/api/analytics").then(setData).catch(() => setData(null));
  }, []);

  const chartData = data?.byIncidentType.map((t) => ({ name: titleCase(t.incidentType), count: t.count })).sort((a, b) => b.count - a.count) ?? [];

  return (
    <>
      <PageHeader title="Analytics" description="Aggregate patterns across the incident graph" />
      <PageContainer className="flex flex-col gap-5">
        {!data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Total incidents" value={String(data.totalIncidents)} icon={ListChecks} />
            <StatTile label="Resolved" value={String(data.resolvedIncidents)} icon={CheckCircle2} tone="success" />
            <StatTile label="Resolution rate" value={data.resolutionRate != null ? formatPercent(data.resolutionRate) : "—"} icon={Gauge} />
            <StatTile label="Avg. resolution time" value={data.avgResolutionMinutes != null ? `${Math.round(data.avgResolutionMinutes / 60)}h` : "—"} icon={Clock} />
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Incidents by type</CardTitle>
            <CardDescription>Distribution of correlated incidents across the nine tracked incident categories</CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ height: Math.max(288, chartData.length * 42) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={170} interval={0} stroke="hsl(var(--muted-foreground))" />
                  <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))" }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </PageContainer>
    </>
  );
}
