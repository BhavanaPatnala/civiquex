"use client";

// Reviewer-facing plate evidence (§26, §27, §35). Deliberately plain: the
// plate, the decision, and — expandable — exactly why the system did or did
// not consider the evidence sufficient. No dashboards, no charts, no raw model
// internals.

import { useState } from "react";
import { ChevronDown, ChevronUp, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { explainPlateDecision } from "@/lib/vision/plateEvidence";
import { UNKNOWN_CHAR, type PlateDecision, type PlateRecoveryResult } from "@/lib/vision/plateTypes";

const DECISION_STYLE: Record<PlateDecision, { label: string; tone: string; icon: typeof ShieldCheck; blurb: string }> = {
  CONFIRMED: {
    label: "Plate confirmed",
    tone: "text-success",
    icon: ShieldCheck,
    blurb: "Independent frames agreed on every character, and the plate was verified as belonging to the tracked vehicle.",
  },
  REVIEW_REQUIRED: {
    label: "Review required",
    tone: "text-warning",
    icon: ShieldQuestion,
    blurb: "There is real evidence here, but at least one question could not be ruled out — an officer should confirm it.",
  },
  PARTIALLY_READABLE: {
    label: "Partially readable",
    tone: "text-warning",
    icon: ShieldQuestion,
    blurb: "Some characters are supported by the footage and some are not. Unsupported positions are left blank rather than guessed.",
  },
  CONFLICTING: {
    label: "Conflicting readings",
    tone: "text-destructive",
    icon: ShieldAlert,
    blurb: "Different frames produced genuinely different plates — this can mean more than one vehicle was in view.",
  },
  UNREADABLE: {
    label: "Plate unreadable",
    tone: "text-muted-foreground",
    icon: ShieldAlert,
    blurb: "The recording does not contain enough legible detail to identify the vehicle. No plate is reported.",
  },
};

/** Renders the plate with unresolved positions visually distinct, so a blank is never mistaken for a character. */
function PlateDisplay({ plate }: { plate: string }) {
  return (
    <span className="font-mono text-lg font-semibold tracking-[0.15em]">
      {plate.split("").map((ch, i) =>
        ch === UNKNOWN_CHAR ? (
          <span key={i} className="text-muted-foreground/60" title="Not supported by the footage — deliberately not guessed">
            {UNKNOWN_CHAR}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
    </span>
  );
}

export function PlateEvidenceCard({ result, className }: { result: PlateRecoveryResult; className?: string }) {
  const [open, setOpen] = useState(false);
  const style = DECISION_STYLE[result.decision];
  const Icon = style.icon;
  const explanation = explainPlateDecision(result);

  return (
    <div className={cn("rounded-lg border border-border bg-card/50 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={cn("flex items-center gap-1.5 text-[13px] font-medium", style.tone)}>
            <Icon className="h-4 w-4 shrink-0" />
            {style.label}
          </span>
          <div className="mt-1.5">
            {result.plate ? (
              <PlateDisplay plate={result.plate} />
            ) : (
              <span className="text-sm text-muted-foreground">No plate reported</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <Badge variant="outline" className="text-[10px] tabular-nums">
            Evidence {result.evidenceQuality}/100
          </Badge>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{style.blurb}</p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Why this result
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <ul className="flex flex-col gap-1">
            {explanation.map((line, i) => (
              <li key={i} className="text-[12px] leading-relaxed text-muted-foreground">
                • {line}
              </li>
            ))}
          </ul>

          {result.bestFrame && (
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              Best evidence frame: {result.bestFrame.sourceTimeSeconds.toFixed(2)}s into the recording (frame {result.bestFrame.frameIndex}).
              Traceable to the original upload — the source recording is never modified.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground/80">
            Detector {result.versions.detector} · tracker {result.versions.tracker} · OCR {result.versions.ocr}
          </p>
        </div>
      )}
    </div>
  );
}
