import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RiskLevelCode } from "@/lib/types";

const CONFIG: Record<RiskLevelCode, { label: string; className: string }> = {
  LOW: { label: "Low", className: "border-transparent bg-muted text-muted-foreground" },
  MEDIUM: { label: "Medium", className: "border-transparent bg-warning/10 text-warning" },
  HIGH: { label: "High", className: "border-transparent bg-warning/20 text-warning" },
  CRITICAL: { label: "Critical", className: "border-transparent bg-critical/15 text-critical" },
};

export function RiskBadge({ level, className }: { level: string; className?: string }) {
  const cfg = CONFIG[level as RiskLevelCode] ?? CONFIG.LOW;
  return (
    <Badge className={cn(cfg.className, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", level === "CRITICAL" ? "bg-critical" : level === "HIGH" ? "bg-warning" : level === "MEDIUM" ? "bg-warning/70" : "bg-muted-foreground")} />
      {cfg.label}
    </Badge>
  );
}
