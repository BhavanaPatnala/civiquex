import { Progress } from "@/components/ui/progress";
import { formatPercent } from "@/lib/utils";
import type { EvidenceConfidenceBreakdown } from "@/lib/types";

const FACTOR_META: Record<keyof EvidenceConfidenceBreakdown, { label: string; description: string }> = {
  visual: { label: "Visual evidence", description: "Image/video quality and detection confidence" },
  location: { label: "Location confidence", description: "GPS accuracy and road-segment match" },
  temporal: { label: "Temporal confidence", description: "Trust in the reported capture time" },
  rule: { label: "Rule confidence", description: "Confidence the applicable regulation was matched correctly" },
  scene: { label: "Scene confidence", description: "Clarity of the surrounding scene context" },
  corroboration: { label: "Corroboration", description: "Independent observations confirming this incident" },
};

export function ConfidenceBreakdownList({ breakdown }: { breakdown: EvidenceConfidenceBreakdown }) {
  return (
    <div className="flex flex-col gap-3">
      {(Object.keys(FACTOR_META) as (keyof EvidenceConfidenceBreakdown)[]).map((key) => {
        const meta = FACTOR_META[key];
        const value = breakdown[key];
        return (
          <div key={key}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-foreground">{meta.label}</span>
              <span className="text-xs font-semibold tabular-nums text-foreground">{formatPercent(value)}</span>
            </div>
            <Progress value={value * 100} className="h-1.5" />
            <p className="mt-1 text-[11px] text-muted-foreground">{meta.description}</p>
          </div>
        );
      })}
    </div>
  );
}

export function ConfidenceSummary({ overall, verdict }: { overall: number; verdict: string }) {
  const label = overall >= 0.82 ? "Strong evidence" : overall >= 0.6 ? "Moderate evidence" : "Evidence insufficient";
  const verdictLabel =
    verdict === "potential_violation" ? "Potential violation" : verdict === "requires_verification" ? "Requires verification" : "Evidence insufficient";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-2xl font-semibold tabular-nums text-foreground">{formatPercent(overall)}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        AI determination: <span className="font-medium text-foreground">{verdictLabel}</span> — never presented as a legal fact.
      </p>
    </div>
  );
}
