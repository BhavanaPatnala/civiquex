"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Flame, Search } from "lucide-react";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidenceCard, type EvidenceCardIncident } from "@/components/domain/evidence-card";
import { useSession } from "@/lib/client/useSession";
import { apiGet } from "@/lib/client/api";
import { formatDateTime, titleCase, cn } from "@/lib/utils";
import { deriveTriage, evidenceScoreOf, TRIAGE_LABEL, type Triage } from "@/lib/presentation/triage";

interface IncidentRow extends EvidenceCardIncident {
  status: string;
}

const FILTERS: { key: "all" | Triage | "resolved"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "action_ready", label: "Strong evidence" },
  { key: "review_required", label: "Review required" },
  { key: "resolved", label: "Resolved" },
];

const TRIAGE_DOT: Record<Triage, string> = {
  action_ready: "bg-success",
  review_required: "bg-warning",
  insufficient: "bg-muted-foreground",
};

export default function IncidentsPage() {
  return (
    <Suspense fallback={null}>
      <IncidentsPageInner />
    </Suspense>
  );
}

function IncidentsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useSession();
  const isStaff = user?.role === "AUTHORITY" || user?.role === "ADMIN";

  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams({ limit: "150" });
    if (q) params.set("q", q);
    setRows(null);
    apiGet<{ total: number; incidents: IncidentRow[] }>(`/api/incidents?${params}`)
      .then((res) => {
        setRows(res.incidents);
        setTotal(res.total);
      })
      .catch(() => {
        setRows([]);
        setTotal(0);
      });
  }, [user, q]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (filter === "all") return rows;
    if (filter === "resolved") return rows.filter((r) => r.status === "RESOLVED");
    return rows.filter((r) => deriveTriage(r.ruleVerdict, r.evidenceConfidenceOverall) === filter);
  }, [rows, filter]);

  if (loading) {
    return (
      <PageContainer className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }

  // A citizen's "Incidents" is their own submission history — a small, personal
  // list, never the searchable repository. That repository view is staff-only,
  // enforced server-side already in /api/incidents (see that route's ownership
  // filter), and mirrored here so the UI never even offers chrome (search across
  // everyone's evidence, jurisdiction filters) that a citizen has no access to.
  if (!isStaff) {
    return (
      <>
        <PageHeader title="Your submissions" description={`${total} submission${total === 1 ? "" : "s"}`} />
        <PageContainer>
          {rows === null ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-64 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-20 text-center">
              <p className="text-sm font-medium text-foreground">No submissions yet</p>
              <Link href="/" className="text-xs text-primary hover:underline">
                Report a civic incident →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <EvidenceCard key={row.id} incident={row} href={`/incidents/${row.id}`} />
              ))}
            </div>
          )}
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Incidents repository" description={`${total} incident${total === 1 ? "" : "s"} in the correlated incident graph`} />
      <PageContainer className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search by incident ID or location…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <div className="flex items-center gap-1 rounded-full bg-muted p-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                  filter === f.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <Card className="overflow-hidden">
          {filtered === null ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-sm font-medium text-foreground">No incidents match</p>
              <p className="text-xs text-muted-foreground">Try a different filter or search term.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Incident</TableHead>
                    <TableHead>Violation</TableHead>
                    <TableHead>Location · time</TableHead>
                    <TableHead>Recordings</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Evidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => {
                    const triage = deriveTriage(row.ruleVerdict, row.evidenceConfidenceOverall);
                    return (
                      <TableRow key={row.id} className="cursor-pointer" onClick={() => router.push(`/incidents/${row.id}`)}>
                        <TableCell>
                          <Link href={`/incidents/${row.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                            {row.publicId}
                          </Link>
                          {row.recurring && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-warning">
                              <Flame className="h-3 w-3" /> recurring
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{titleCase(row.incidentType)}</TableCell>
                        <TableCell className="max-w-[240px] text-xs text-muted-foreground">
                          <div className="truncate">{row.roadSegment?.name ?? row.location?.address ?? "Unmatched"}</div>
                          <div>{formatDateTime(row.createdAt)}</div>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">{row.observationCount}</TableCell>
                        <TableCell className="text-xs tabular-nums text-muted-foreground">{evidenceScoreOf(row.evidenceConfidenceOverall)}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-[12px] font-medium">
                            <span className={cn("h-1.5 w-1.5 rounded-full", TRIAGE_DOT[triage])} aria-hidden />
                            {row.status === "RESOLVED" ? "Resolved" : TRIAGE_LABEL[triage]}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </PageContainer>
    </>
  );
}
