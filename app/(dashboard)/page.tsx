"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Camera, ChevronRight, ShieldCheck, Video } from "lucide-react";
import { PageContainer } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/client/useSession";
import { apiGet } from "@/lib/client/api";
import { deriveTriage } from "@/lib/presentation/triage";

interface IncidentsResponse {
  total: number;
  incidents: { ruleVerdict: string; evidenceConfidence: number }[];
}

interface Summary {
  total: number;
  actionReady: number;
  underReview: number;
}

export default function PublicHomePage() {
  const { user } = useSession();
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiGet<IncidentsResponse>("/api/incidents?limit=200")
      .then((res) => {
        if (cancelled) return;
        let actionReady = 0;
        let underReview = 0;
        for (const inc of res.incidents) {
          const t = deriveTriage(inc.ruleVerdict, inc.evidenceConfidence);
          if (t === "action_ready") actionReady++;
          else if (t === "review_required") underReview++;
        }
        setSummary({ total: res.total, actionReady, underReview });
      })
      .catch(() => !cancelled && setSummary(null));
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <PageContainer className="mx-auto flex max-w-3xl flex-col gap-5 py-6 sm:py-10">
      <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent animate-in fade-in slide-in-from-bottom-3 duration-500">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-fuchsia-500/15 blur-3xl" />
        <CardContent className="relative flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">CiviqueX · Civic Evidence Verification</span>
          </div>
          <div>
            <h1 className="text-3xl font-semibold leading-[1.15] tracking-tight text-foreground sm:text-4xl">
              Capture. <span className="bg-gradient-to-r from-primary to-fuchsia-500 bg-clip-text text-transparent">We verify.</span>
              <br />
              Civic good.
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              Upload a photo or recording. CiviqueX identifies the incident, verifies the evidence, and routes it to the right traffic authority
              automatically.
            </p>
          </div>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <Button asChild size="lg" className="flex-1 shadow-md shadow-primary/30 transition-transform active:scale-[0.98]">
              <Link href="/report?mode=video">
                <Video className="h-4 w-4" /> Upload video
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="flex-1 transition-transform active:scale-[0.98]">
              <Link href="/report?mode=photo">
                <Camera className="h-4 w-4" /> Upload photo
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {user && (
        <Card className="animate-in fade-in slide-in-from-bottom-3 overflow-hidden duration-500 [animation-delay:100ms] [animation-fill-mode:backwards]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm font-medium text-foreground">Your submissions</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Evidence you&apos;ve captured and where it stands</p>
            </div>
            <Link href="/incidents" className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-primary hover:underline">
              View all <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
          <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
            {!summary ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 py-4">
                  <Skeleton className="h-6 w-8" />
                  <Skeleton className="h-3 w-14" />
                </div>
              ))
            ) : (
              <>
                <SummaryStat value={summary.total} label="Submissions" />
                <SummaryStat value={summary.actionReady} label="Verified" />
                <SummaryStat value={summary.underReview} label="Under review" />
              </>
            )}
          </div>
        </Card>
      )}

      {!user && (
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>{" "}
          to track the status of what you submit.
        </p>
      )}
    </PageContainer>
  );
}

function SummaryStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-4">
      <span className="text-xl font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}
