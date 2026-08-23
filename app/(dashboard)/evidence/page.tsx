"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Car, Radio, Smartphone } from "lucide-react";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/client/api";
import { formatDateTime, titleCase } from "@/lib/utils";
import { INCIDENT_TYPES } from "@/lib/types";

interface ObservationRow {
  id: string;
  sourceType: string;
  incidentTypeGuess: string;
  capturedAt: string;
  lat: number;
  lng: number;
  status: string;
  incidentIds: string[];
}

const SOURCE_ICON = { CITIZEN: Smartphone, DASHCAM: Car, AUTHORIZED_SENSOR: Radio };

export default function EvidencePage() {
  const [rows, setRows] = useState<ObservationRow[] | null>(null);
  const [incidentType, setIncidentType] = useState("all");

  useEffect(() => {
    const params = new URLSearchParams({ limit: "100" });
    if (incidentType !== "all") params.set("incidentType", incidentType);
    setRows(null);
    apiGet<ObservationRow[]>(`/api/observations?${params}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [incidentType]);

  return (
    <>
      <PageHeader title="Evidence" description="Every independent observation captured by the platform, before and after correlation" />
      <PageContainer className="flex flex-col gap-4">
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

        <Card className="overflow-hidden">
          {rows === null ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No evidence recorded yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Captured</TableHead>
                  <TableHead>Coordinates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Linked incident</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const Icon = SOURCE_ICON[row.sourceType as keyof typeof SOURCE_ICON] ?? Smartphone;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {titleCase(row.sourceType)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{titleCase(row.incidentTypeGuess)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(row.capturedAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.lat.toFixed(4)}, {row.lng.toFixed(4)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {titleCase(row.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.incidentIds.length > 0 ? (
                          <Link href={`/incidents/${row.incidentIds[0]}`} className="text-xs text-primary hover:underline">
                            View incident
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not yet linked</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </PageContainer>
    </>
  );
}
