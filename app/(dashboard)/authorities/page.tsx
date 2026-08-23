"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/domain/risk-badge";
import { StatusBadge } from "@/components/domain/status-badge";
import { AuthorityResponseDialog } from "@/components/domain/authority-response-dialog";
import { apiGet } from "@/lib/client/api";
import { useSession } from "@/lib/client/useSession";
import { titleCase, formatDateTime } from "@/lib/utils";
import { INCIDENT_TYPES } from "@/lib/types";

interface AuthorityRow {
  id: string;
  name: string;
  jurisdiction: string;
  supportedIncidentTypes: string[];
  officialUrl: string | null;
  apiAvailable: boolean;
  submissionMethod: string;
  evidenceRequirements: string;
  escalationMethod: string | null;
  statusTrackingAvailable: boolean;
  incidentCount: number;
  submissionCount: number;
}

interface QueueRow {
  id: string;
  publicId: string;
  incidentType: string;
  status: string;
  riskLevel: string;
  evidenceConfidence: number;
  createdAt: string;
}

export default function AuthoritiesPage() {
  const { user } = useSession();
  const [authorities, setAuthorities] = useState<AuthorityRow[] | null>(null);
  const [queue, setQueue] = useState<QueueRow[] | null>(null);

  useEffect(() => {
    apiGet<AuthorityRow[]>("/api/authorities").then(setAuthorities).catch(() => setAuthorities([]));
  }, []);

  useEffect(() => {
    if (user?.role === "AUTHORITY" && user.authorityId) {
      apiGet<{ incidents: QueueRow[] }>(`/api/incidents?authorityId=${user.authorityId}&limit=50`)
        .then((r) => setQueue(r.incidents))
        .catch(() => setQueue([]));
    }
  }, [user]);

  return (
    <>
      <PageHeader title="Authorities" description="Jurisdiction registry and, for authority accounts, a priority response queue" />
      <PageContainer className="flex flex-col gap-6">
        {user?.role === "AUTHORITY" && (
          <Card>
            <CardHeader>
              <CardTitle>Your priority queue</CardTitle>
              <CardDescription>Why this matters — not just &quot;someone complained&quot;: risk, recurrence, and evidence confidence are shown up front</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {queue === null ? (
                <div className="flex flex-col gap-2 p-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : queue.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">No incidents currently routed to your authority.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Incident</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Reported</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queue.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell>
                          <Link href={`/incidents/${q.id}`} className="font-medium text-primary hover:underline">
                            {q.publicId}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs">{titleCase(q.incidentType)}</TableCell>
                        <TableCell>
                          <StatusBadge status={q.status} />
                        </TableCell>
                        <TableCell>
                          <RiskBadge level={q.riskLevel} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDateTime(q.createdAt)}</TableCell>
                        <TableCell>
                          {q.status !== "OBSERVED" && q.status !== "EVIDENCE_VALIDATED" && (
                            <AuthorityResponseDialog incidentId={q.id} onDone={() => setQueue(null)} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        <div>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Authority registry</h2>
          {authorities === null ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-52" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {authorities.map((a) => (
                <Card key={a.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-1.5">
                      <Landmark className="h-3.5 w-3.5 text-primary" /> {a.name}
                    </CardTitle>
                    <CardDescription>{a.jurisdiction}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-xs">
                    <div className="flex flex-wrap gap-1.5">
                      {a.supportedIncidentTypes.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px]">
                          {INCIDENT_TYPES.find((i) => i.code === t)?.label ?? titleCase(t)}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-muted-foreground">{a.evidenceRequirements}</p>
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                      <Badge variant={a.submissionMethod === "official_api" ? "success" : "muted"} className="text-[10px]">
                        {a.submissionMethod === "official_api" ? "Official API" : a.submissionMethod === "assisted_manual" ? "Assisted manual submission" : "Submission unavailable"}
                      </Badge>
                      <span>{a.incidentCount} incidents · {a.submissionCount} submitted</span>
                    </div>
                    {a.escalationMethod && <p className="text-[11px] text-muted-foreground">Escalation: {a.escalationMethod}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </PageContainer>
    </>
  );
}
