"use client";

import { ShieldHalf, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared shell for /login and /signup — the same premium dark-violet gradient treatment used across the rest of the app. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-primary/15 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-3xl" aria-hidden />
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}

export function AuthHeader() {
  return (
    <div className="mb-6 flex animate-in flex-col items-center gap-2 fade-in slide-in-from-bottom-2 duration-500 [animation-fill-mode:backwards]">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
        <ShieldHalf className="h-5 w-5" />
      </div>
      <span className="text-lg font-semibold tracking-tight text-foreground">CiviqueX</span>
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="mb-4 flex animate-in items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive fade-in slide-in-from-top-1 duration-300">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p className="flex-1">{message}</p>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className={cn("shrink-0 text-destructive/70 transition-colors hover:text-destructive")}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
