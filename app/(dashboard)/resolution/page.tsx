"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/domain/status-badge";
import { RiskBadge } from "@/components/domain/risk-badge";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast-provider";
import { formatDateTime, titleCase } from "@/lib/utils";

interface IncidentRow {
  id: string;
  publicId: string;
  incidentType: string;
  status: string;
  riskLevel: string;
  roadSegment: { name: string } | null;
  location: { address: string } | null;
  updatedAt: string;
}

const PENDING_STATUSES = ["SUBMITTED", "AUTHORITY_ACKNOWLEDGED", "ACTION_REPORTED", "INDEPENDENT_VERIFICATION", "STILL_PRESENT", "REOPENED"];

export default function ResolutionPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    Promise.all(
      PENDING_STATUSES.map((status) => apiGet<{ incidents: IncidentRow[] }>(`/api/incidents?status=${status}&limit=50`))
    )
      .then((results) => {
        const merged = results.flatMap((r) => r.incidents);
        merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        setRows(merged);
      })
      .catch(() => setRows([]));
  }

  useEffect(() => {
    load();
  }, []);

  async function verify(id: string) {
    setBusyId(id);
    try {
      const res = await apiPost<{ result: { result: string }; status: string }>(`/api/incidents/${id}/resolution-check`);
      toast({
        title: `Resolution check: ${res.result.result.replaceAll("_", " ")}`,
        variant: res.result.result === "still_present" ? "destructive" : "success",
      });
      load();
    } catch (err) {
      toast({ title: "Could not run verification", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Resolution"
        description="Incidents awaiting independent re-verification — an authority's reported status is never trusted alone"
      />
      <PageContainer>
        <Card className="overflow-hidden">
          {rows === null ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <ShieldCheck className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">Nothing pending resolution verification</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Incident</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link href={`/incidents/${row.id}`} className="font-medium text-primary hover:underline">
                        {row.publicId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{titleCase(row.incidentType)}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {row.roadSegment?.name ?? row.location?.address ?? "Unmatched"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <RiskBadge level={row.riskLevel} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(row.updatedAt)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => verify(row.id)} disabled={busyId !== null}>
                        {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                        Verify again
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </PageContainer>
    </>
  );
}
