import { Badge } from "@/components/ui/badge";

const CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "success" | "warning" | "critical" | "muted" }> = {
  OBSERVED: { label: "Observed", variant: "muted" },
  EVIDENCE_VALIDATED: { label: "Evidence validated", variant: "outline" },
  SUBMITTED: { label: "Submitted", variant: "default" },
  AUTHORITY_ACKNOWLEDGED: { label: "Acknowledged", variant: "outline" },
  ACTION_REPORTED: { label: "Action reported", variant: "warning" },
  INDEPENDENT_VERIFICATION: { label: "Verifying", variant: "outline" },
  RESOLVED: { label: "Resolved", variant: "success" },
  STILL_PRESENT: { label: "Still present", variant: "critical" },
  REOPENED: { label: "Reopened", variant: "critical" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const cfg = CONFIG[status] ?? { label: status, variant: "muted" as const };
  return (
    <Badge variant={cfg.variant} className={className}>
      {cfg.label}
    </Badge>
  );
}
