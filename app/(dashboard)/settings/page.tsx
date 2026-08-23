"use client";

import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSession } from "@/lib/client/useSession";

export default function SettingsPage() {
  const { user } = useSession();

  return (
    <>
      <PageHeader title="Settings" description="Account, privacy, and data-mode configuration" />
      <PageContainer className="flex max-w-2xl flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {user ? (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span>{user.name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{user.email}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Role</span><Badge variant="outline">{user.role}</Badge></div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">You are browsing the public dashboards without signing in.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data mode</CardTitle>
            <CardDescription>This deployment&apos;s data source configuration</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-dashed">DEMO DATA</Badge>
              <span className="text-xs text-muted-foreground">Deterministic, offline dataset — not sourced from a live government system</span>
            </div>
            <p className="text-xs text-muted-foreground">
              DataProvider / AuthorityProvider / MapProvider / RuleProvider are implemented as swappable adapters. Map tiles are real OpenStreetMap
              tiles. No government API is fabricated — where no verified integration exists, the platform reports &quot;External submission
              unavailable&quot; and falls back to an assisted manual workflow.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Privacy &amp; evidence handling</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>Faces are blurred by default on stored evidence. Vehicle/event identification is preferred over human identification.</p>
            <Separator />
            <p>License plates, where legally captured, are stored only as a one-way hash — never as raw text.</p>
            <Separator />
            <p>Evidence media is kept separate from public content, access-logged on every view, and automatically expires after the configured retention period (180 days in this demo).</p>
            <Separator />
            <p>There is no public &quot;bad driver&quot; database. Incidents are tied to vehicle fingerprints and locations, not to identified individuals.</p>
          </CardContent>
        </Card>
      </PageContainer>
    </>
  );
}
