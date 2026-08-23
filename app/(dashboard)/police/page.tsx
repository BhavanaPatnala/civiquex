"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardList, Inbox, Loader2, ShieldAlert } from "lucide-react";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidenceCard, type EvidenceCardIncident } from "@/components/domain/evidence-card";
import { useSession } from "@/lib/client/useSession";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast-provider";
import { deriveTriage } from "@/lib/presentation/triage";

interface IncidentsResponse {
  total: number;
  incidents: EvidenceCardIncident[];
}

export default function PoliceHomePage() {
  const router = useRouter();
  const { user, loading } = useSession();
  const { toast } = useToast();
  const [rows, setRows] = useState<EvidenceCardIncident[] | null>(null);
  const [switchingDemo, setSwitchingDemo] = useState(false);

  useEffect(() => {
    if (!user || user.role === "CITIZEN") return;
    apiGet<IncidentsResponse>("/api/incidents?limit=50")
      .then((res) => setRows(res.incidents))
      .catch(() => setRows([]));
  }, [user]);

  async function signInAsDemoOfficer() {
    setSwitchingDemo(true);
    try {
      await apiPost("/api/auth/login", { email: "authority.zone9@demo.civiquex.app", password: "Password123!" });
      // A hard navigation, not just refetching this component's session:
      // Header/MobileNav each hold their own independent useSession() state
      // (there's no shared session context), so only a fresh mount of the
      // whole dashboard shell guarantees every one of them — not just this
      // page — reflects the new account.
      window.location.href = "/police";
    } catch (err) {
      toast({ title: "Could not switch accounts", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
      setSwitchingDemo(false);
    }
  }

  if (loading) {
    return (
      <PageContainer className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }

  // The Police tab is always visible in navigation — data access is what's
  // actually gated (server-side, in the incidents API), never the nav itself.
  // A citizen or signed-out visitor sees a clear explanation here instead of
  // being silently bounced back to Public.
  if (!user || user.role === "CITIZEN") {
    return (
      <PageContainer className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Officer sign-in required</p>
        <p className="text-xs text-muted-foreground">
          This queue only shows evidence routed to a traffic authority — sign in with an officer or admin account to see it.
        </p>
        {!user ? (
          <Button size="sm" onClick={() => router.push("/login")}>
            Go to sign in
          </Button>
        ) : (
          <Button size="sm" onClick={signInAsDemoOfficer} disabled={switchingDemo}>
            {switchingDemo && <Loader2 className="h-4 w-4 animate-spin" />}
            Switch to demo officer account
          </Button>
        )}
      </PageContainer>
    );
  }

  const actionReady = rows?.filter((r) => deriveTriage(r.ruleVerdict, r.evidenceConfidenceOverall) === "action_ready").length ?? 0;
  const reviewRequired = rows?.filter((r) => deriveTriage(r.ruleVerdict, r.evidenceConfidenceOverall) === "review_required").length ?? 0;
  const newToday = rows?.filter((r) => new Date(r.createdAt).toDateString() === new Date().toDateString()).length ?? 0;

  return (
    <>
      <PageHeader title="Action required" description={rows ? `${actionReady + reviewRequired} incident(s) awaiting officer action` : "Loading…"} />
      <PageContainer className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard icon={CheckCircle2} tone="success" value={actionReady} label="Strong evidence" />
          <StatCard icon={ClipboardList} tone="warning" value={reviewRequired} label="Review required" />
          <StatCard icon={Inbox} tone="default" value={newToday} label="New today" />
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold tracking-tight text-foreground">Recent incidents</h2>
          {rows === null ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-64 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
                <Inbox className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">No incidents in your queue yet</p>
                <p className="max-w-sm text-xs text-muted-foreground">New citizen submissions routed to your authority will appear here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <EvidenceCard key={row.id} incident={row} href={`/incidents/${row.id}`} showScore />
              ))}
            </div>
          )}
        </div>
      </PageContainer>
    </>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  tone: "success" | "warning" | "default";
}) {
  const toneClass = tone === "success" ? "text-success bg-success/10" : tone === "warning" ? "text-warning bg-warning/10" : "text-muted-foreground bg-muted";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
          <div className="text-[11px] text-muted-foreground">{label}</div>
        </div>
      </div>
    </Card>
  );
}
