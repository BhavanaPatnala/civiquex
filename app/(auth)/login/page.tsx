"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ShieldHalf, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    }
  }, [searchParams]);

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
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="mb-6 flex items-center justify-center gap-2">
          <ShieldHalf className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold tracking-tight">CiviqueX</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Road Safety Evidence &amp; Accountability Platform — demo environment</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button type="submit" disabled={loading} className="mt-1">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Sign in
              </Button>
            </form>

            <div className="mt-5 rounded-md border border-dashed border-border p-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Demo accounts (password: Password123!)</p>
              <ul className="flex flex-col gap-1">
                {DEMO_ACCOUNTS.map((acc) => (
                  <li key={acc.email}>
                    <button
                      type="button"
                      className="text-left text-xs text-primary hover:underline"
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
        <p className="mt-4 text-center text-xs text-muted-foreground">
          New here?{" "}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          <Link href="/" className="hover:underline">
            Continue browsing public dashboards without signing in
          </Link>
        </p>
      </div>
    </div>
  );
}
