"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronDown, CheckCircle2, Circle, Flame, Loader2, ShieldCheck, Upload } from "lucide-react";
import { PageContainer } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/domain/status-badge";
import { EvidenceTimeline, type EvidenceObservation } from "@/components/domain/evidence-timeline";
import { CityMapDynamic } from "@/components/domain/city-map-dynamic";
import { AuthorityResponseDialog } from "@/components/domain/authority-response-dialog";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";
import { useSession } from "@/lib/client/useSession";
import { useToast } from "@/components/ui/toast-provider";
import { formatDateTime, titleCase, cn } from "@/lib/utils";
import { verificationChecklist, deriveTriage, evidenceScoreOf, TRIAGE_LABEL } from "@/lib/presentation/triage";
import { alternativeExplanations, unresolvedCount } from "@/lib/presentation/alternatives";
import { describeCaptured, vehicleLine, locationVerifiedLine } from "@/lib/presentation/plainLanguage";

interface IncidentDetail {
  id: string;
  publicId: string;
  incidentType: string;
  status: string;
  riskLevel: string;
  evidenceConfidenceOverall: number;
  evidenceConfidenceBreakdown: { visual: number; location: number; temporal: number; rule: number; scene: number; corroboration: number };
  ruleVerdict: string;
  ruleReasoning: string;
  contextChecks: { label: string; passed: boolean; detail: string }[];
  recurring: boolean;
  createdAt: string;
  updatedAt: string;
  location: { lat: number; lng: number; address: string } | null;
  roadSegment: { id: string; name: string; roadClass: string; schoolNearby: boolean; hospitalNearby: boolean; junctionType: string | null } | null;
  authority: { id: string; name: string; jurisdiction: string; submissionMethod: string; officialUrl: string | null; evidenceRequirements: string } | null;
  hotspot: { id: string; incidentCount: number; recurringCount: number; avgDurationMinutes: number | null } | null;
  observations: EvidenceObservation[];
  submissions: {
    id: string;
    authorityId: string;
    channel: string;
    referenceNumber: string | null;
    status: string;
    submittedAt: string;
    events: { eventType: string; note: string | null; occurredAt: string }[];
  }[];
  resolutionChecks: {
    id: string;
    checkedAt: string;
    result: string;
    confidence: number;
    similarityScore: number | null;
    objectPresenceDelta: { label: string; presentBefore: boolean; presentAfter: boolean | null }[];
  }[];
  riskScoreHistory: { computedAt: string; score: number; level: string; factors: Record<string, number> }[];
  auditLog: { action: string; createdAt: string; metadata: unknown }[];
}

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const { user } = useSession();
  const { toast } = useToast();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<IncidentDetail>(`/api/incidents/${params.id}`)
      .then(setIncident)
      .catch(() => setIncident(null));
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit() {
    setBusy("submit");
    try {
      await apiPost(`/api/incidents/${params.id}/submit`);
      toast({ title: "Submitted to authority", variant: "success" });
      load();
    } catch (err) {
      toast({ title: "Could not submit", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function handleVerifyAgain() {
    setBusy("verify");
    try {
      const res = await apiPost<{ result: { result: string }; status: string }>(`/api/incidents/${params.id}/resolution-check`);
      toast({
        title: `Verification: ${res.result.result.replaceAll("_", " ")}`,
        description: "An independent re-check — the authority's own report is never taken as the final word.",
        variant: res.result.result === "still_present" ? "destructive" : "success",
      });
      load();
    } catch (err) {
      toast({ title: "Could not run verification", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  if (incident === null) {
    return (
      <PageContainer>
        <Skeleton className="h-8 w-64" />
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </PageContainer>
    );
  }

  const isAuthorityForIncident = user?.role === "AUTHORITY" && user.authorityId === incident.authority?.id;
  const alreadySubmitted = incident.submissions.length > 0;
  const triage = deriveTriage(incident.ruleVerdict, incident.evidenceConfidenceOverall);
  const vehicle = incident.observations.find((o) => o.observation.vehicle)?.observation.vehicle ?? null;
  const primaryObservation = incident.observations[0]?.observation;
  const place = incident.roadSegment?.name ?? incident.location?.address ?? "Location unavailable";
  const captured = describeCaptured(incident.incidentType, primaryObservation ?? null);
  const checks = alternativeExplanations({
    breakdown: incident.evidenceConfidenceBreakdown,
    corroboratingObservations: Math.max(0, incident.observations.length - 1),
    contextChecks: incident.contextChecks,
  });
  const unresolved = unresolvedCount(checks);

  return (
    <PageContainer className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <Link href="/incidents" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{titleCase(incident.incidentType)}</h1>
          {incident.recurring && (
            <Badge variant="warning" className="gap-1">
              <Flame className="h-3 w-3" /> Recurring location
            </Badge>
          )}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{incident.publicId}</span>
          <span aria-hidden>·</span>
          <StatusBadge status={incident.status} className="text-[10px]" />
          <span aria-hidden>·</span>
          <span>Reported {formatDateTime(incident.createdAt)}</span>
        </p>
      </div>

      {/* RESULT — the one thing that actually matters at a glance */}
      <Card className={cn("border-2", triage === "action_ready" && "border-success/40", triage === "review_required" && "border-warning/40")}>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Evidence</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", triage === "action_ready" ? "bg-success" : triage === "review_required" ? "bg-warning" : "bg-muted-foreground")} aria-hidden />
                <span className="text-lg font-semibold text-foreground">{TRIAGE_LABEL[triage]}</span>
                {(user?.role === "AUTHORITY" || user?.role === "ADMIN") && (
                  <span className="text-xs tabular-nums text-muted-foreground">{evidenceScoreOf(incident.evidenceConfidenceOverall)}/100</span>
                )}
              </div>
            </div>
            {incident.status === "RESOLVED" && (
              <Badge variant="success" className="text-[11px]">
                Resolved
              </Badge>
            )}
            {incident.status !== "RESOLVED" && alreadySubmitted && (
              <Badge variant="outline" className="text-[11px]">
                Submitted
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!alreadySubmitted && (
              <Button
                onClick={handleSubmit}
                disabled={busy !== null || !incident.authority || triage === "insufficient"}
                title={triage === "insufficient" ? "Evidence is insufficient — this can't be submitted to an authority" : undefined}
              >
                {busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Submit to authority
              </Button>
            )}
            <Button variant="outline" onClick={handleVerifyAgain} disabled={busy !== null}>
              {busy === "verify" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Verify again
            </Button>
            {isAuthorityForIncident && alreadySubmitted && <AuthorityResponseDialog incidentId={incident.id} onDone={load} />}
          </div>
          {!alreadySubmitted && triage === "insufficient" && (
            <p className="text-xs text-muted-foreground">
              There isn&apos;t enough real evidence to act on — see &quot;What happened&quot; below. This stays on record, but can&apos;t be forwarded
              to an authority as-is.
            </p>
          )}
          {!alreadySubmitted && triage !== "insufficient" && !incident.authority && (
            <p className="text-xs text-muted-foreground">No authority is registered for this location and incident type yet.</p>
          )}
        </CardContent>
      </Card>

      {/* WHAT / WHERE / WHEN / VEHICLE */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <InfoRow
            label="What happened"
            value={captured.text}
            full
            tone={captured.nothingRelevant ? "warning" : "default"}
          />
          <InfoRow label="Where" value={place} hint={incident.location ? locationVerifiedLine(incident.evidenceConfidenceBreakdown.location) : undefined} />
          <InfoRow label="When" value={primaryObservation ? formatDateTime(primaryObservation.capturedAt) : "—"} />
          <InfoRow label="Vehicle" value={vehicleLine(vehicle)} full />
        </CardContent>
      </Card>

      {/* PROOF */}
      <Card>
        <CardHeader>
          <CardTitle>Proof</CardTitle>
          <CardDescription>
            {incident.observations.length} supporting recording{incident.observations.length === 1 ? "" : "s"}
            {incident.observations.length > 1 ? " — independently confirming the same event" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EvidenceTimeline items={incident.observations} />
        </CardContent>
      </Card>

      {/* WHY WE FLAGGED IT */}
      <Card>
        <CardHeader>
          <CardTitle>Why we flagged it</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-foreground">{incident.ruleReasoning}</p>
          {incident.roadSegment && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {incident.roadSegment.schoolNearby && <Badge variant="outline" className="text-[10px]">School nearby</Badge>}
              {incident.roadSegment.hospitalNearby && <Badge variant="outline" className="text-[10px]">Hospital nearby</Badge>}
              {incident.roadSegment.junctionType && incident.roadSegment.junctionType !== "none" && (
                <Badge variant="outline" className="text-[10px]">{titleCase(incident.roadSegment.junctionType)} junction</Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CHECKS COMPLETED */}
      <Card className="overflow-hidden">
        <details className="group" open>
          <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-5">
            <p className="text-sm font-semibold tracking-tight text-foreground">Checks completed</p>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-2 border-t border-border px-6 py-4">
            {verificationChecklist(incident.evidenceConfidenceBreakdown).map((item) => (
              <div key={item.label} className={cn("flex items-center gap-2 text-sm", item.passed ? "text-foreground" : "text-muted-foreground")}>
                {item.passed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <Circle className="h-4 w-4 shrink-0" />}
                {item.label}
              </div>
            ))}
          </div>
        </details>
      </Card>

      {/* POSSIBLE OTHER EXPLANATIONS */}
      <Card className="overflow-hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-5">
            <div>
              <p className="text-sm font-semibold tracking-tight text-foreground">Other explanations considered</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {unresolved === 0 ? "No significant conflicting evidence found" : "Some possibilities still need review"}
              </p>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-3 border-t border-border px-6 py-4">
            {checks.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                {c.ruledOut ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </details>
      </Card>

      {incident.location && (
        <Card>
          <CardHeader>
            <CardTitle>Location</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-52">
              <CityMapDynamic
                incidents={[
                  {
                    id: incident.id,
                    publicId: incident.publicId,
                    lat: incident.location.lat,
                    lng: incident.location.lng,
                    riskLevel: incident.riskLevel as never,
                    status: incident.status,
                    incidentType: incident.incidentType,
                  },
                ]}
                className="h-full w-full"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {incident.resolutionChecks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Resolution checks</CardTitle>
            <CardDescription>An authority marking this &quot;resolved&quot; is verified independently, not taken on trust</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {incident.resolutionChecks.map((c) => (
              <div key={c.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant={c.result === "likely_resolved" ? "success" : c.result === "still_present" ? "critical" : "muted"}>
                    {c.result === "likely_resolved" ? "Likely resolved" : c.result === "still_present" ? "Still present" : titleCase(c.result)}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{formatDateTime(c.checkedAt)}</span>
                </div>
                {c.objectPresenceDelta.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.objectPresenceDelta.map((d, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">
                        {d.label.replace(/_/g, " ")}: {d.presentAfter == null ? "pending" : d.presentAfter ? "still present" : "no longer present"}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Authority &amp; submission</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {incident.authority ? (
            <div className="text-sm">
              <span className="font-medium">{incident.authority.name}</span>
              <span className="text-muted-foreground"> — {incident.authority.jurisdiction}</span>
              <p className="mt-1 text-xs text-muted-foreground">{incident.authority.evidenceRequirements}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No registered authority covers this location and incident type yet.</p>
          )}

          {incident.submissions.map((s) => (
            <div key={s.id}>
              <Separator className="my-2" />
              <p className="text-xs text-muted-foreground">
                Reference <span className="font-mono text-foreground">{s.referenceNumber}</span> · submitted {formatDateTime(s.submittedAt)}
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {s.events.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    <span className="font-medium">{titleCase(e.eventType)}</span>
                    <span className="text-muted-foreground">{formatDateTime(e.occurredAt)}</span>
                    {e.note && <span className="text-muted-foreground">— {e.note}</span>}
                  </div>
                ))}
                {s.events.length === 0 && <p className="text-xs text-muted-foreground">Awaiting authority response.</p>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {incident.hotspot && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-warning" /> Recurring location
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p>{incident.hotspot.incidentCount} incidents of this type recorded at this location.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto scroll-thin text-xs">
            {incident.auditLog.map((a, i) => (
              <div key={i} className="border-b border-border pb-1.5 last:border-0">
                <span className="font-medium">{historyLabel(a.action)}</span>
                <span className="ml-1.5 text-muted-foreground">{formatDateTime(a.createdAt)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function InfoRow({
  label,
  value,
  hint,
  full = false,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  full?: boolean;
  tone?: "default" | "warning";
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm", tone === "warning" ? "text-warning" : "text-foreground")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  "incident.created": "Incident created",
  "incident.correlated": "New recording added",
  "incident.updated": "Status updated",
  "incident.submitted": "Submitted to authority",
  "incident.verified": "Reviewed by officer",
  "resolution.checked": "Resolution checked",
};

function historyLabel(action: string): string {
  return HISTORY_LABEL[action] ?? action.replace(/[._]/g, " ");
}
