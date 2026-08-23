"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthShell, AuthHeader, ErrorBanner } from "@/components/layout/auth-shell";
import { apiPost, ApiError } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast-provider";

export default function SignupPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      await apiPost("/api/auth/signup", { name, email, password });
      toast({ title: "Account created", variant: "success" });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <AuthHeader />
      <Card className="border-border/80 shadow-xl shadow-black/20 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:60ms] [animation-fill-mode:backwards]">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Report road safety issues and track their outcome</CardDescription>
        </CardHeader>
        <CardContent>
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex animate-in flex-col gap-1.5 fade-in slide-in-from-bottom-1 duration-300 [animation-delay:80ms] [animation-fill-mode:backwards]">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" minLength={2} />
            </div>
            <div className="flex animate-in flex-col gap-1.5 fade-in slide-in-from-bottom-1 duration-300 [animation-delay:120ms] [animation-fill-mode:backwards]">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div className="flex animate-in flex-col gap-1.5 fade-in slide-in-from-bottom-1 duration-300 [animation-delay:160ms] [animation-fill-mode:backwards]">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="flex animate-in flex-col gap-1.5 fade-in slide-in-from-bottom-1 duration-300 [animation-delay:200ms] [animation-fill-mode:backwards]">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="mt-1 animate-in fade-in slide-in-from-bottom-1 shadow-md shadow-primary/20 duration-300 [animation-delay:240ms] [animation-fill-mode:backwards] active:scale-[0.98]"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create account
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="mt-4 animate-in text-center text-xs text-muted-foreground fade-in duration-500 [animation-delay:280ms] [animation-fill-mode:backwards]">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
