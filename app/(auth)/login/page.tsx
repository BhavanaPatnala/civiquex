"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthShell, AuthHeader, ErrorBanner } from "@/components/layout/auth-shell";
import { apiPost, ApiError } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast-provider";

const DEMO_ACCOUNTS = [
  { email: "citizen1@demo.civiquex.app", role: "Citizen" },
  { email: "authority.zone9@demo.civiquex.app", role: "Authority — GCC Zone 9" },
  { email: "authority.traffic@demo.civiquex.app", role: "Authority — Traffic Police" },
  { email: "admin@demo.civiquex.app", role: "Admin" },
];

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [email, setEmail] = useState("citizen1@demo.civiquex.app");
  const [password, setPassword] = useState("Password123!");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("sessionExpired") === "1") {
      setError("Your session ended (often because the demo data was reset) — sign in again to continue.");
      // Strip the query param immediately so a plain page refresh doesn't
      // keep re-showing this message forever — the URL itself was the bug,
      // not a persistent server-side flag.
      router.replace("/login", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiPost("/api/auth/login", { email, password });
      toast({ title: "Welcome back", variant: "success" });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <AuthHeader />
      <Card className="border-border/80 shadow-xl shadow-black/20 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:60ms] [animation-fill-mode:backwards]">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Road Safety Evidence &amp; Accountability Platform — demo environment</CardDescription>
        </CardHeader>
        <CardContent>
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex animate-in flex-col gap-1.5 fade-in slide-in-from-bottom-1 duration-300 [animation-delay:100ms] [animation-fill-mode:backwards]">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div className="flex animate-in flex-col gap-1.5 fade-in slide-in-from-bottom-1 duration-300 [animation-delay:150ms] [animation-fill-mode:backwards]">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="mt-1 animate-in fade-in slide-in-from-bottom-1 shadow-md shadow-primary/20 duration-300 [animation-delay:200ms] [animation-fill-mode:backwards] active:scale-[0.98]"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>

          <div className="mt-5 animate-in rounded-lg border border-dashed border-border/80 bg-muted/40 p-3 fade-in duration-300 [animation-delay:250ms] [animation-fill-mode:backwards]">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Demo accounts (password: Password123!)</p>
            <ul className="flex flex-col gap-1">
              {DEMO_ACCOUNTS.map((acc) => (
                <li key={acc.email}>
                  <button
                    type="button"
                    className="text-left text-xs text-primary transition-colors hover:underline"
                    onClick={() => setEmail(acc.email)}
                  >
                    {acc.email}
                  </button>
                  <span className="ml-1.5 text-[11px] text-muted-foreground">({acc.role})</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
      <p className="mt-4 animate-in text-center text-xs text-muted-foreground fade-in duration-500 [animation-delay:300ms] [animation-fill-mode:backwards]">
        New here?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
      <p className="mt-2 animate-in text-center text-xs text-muted-foreground fade-in duration-500 [animation-delay:300ms] [animation-fill-mode:backwards]">
        <Link href="/" className="hover:underline">
          Continue browsing public dashboards without signing in
        </Link>
      </p>
    </AuthShell>
  );
}
