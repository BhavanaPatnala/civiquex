import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

export function DemoBadge({ label = "DEMO DATA" }: { label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="cursor-help border-dashed text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        This is a deterministic, offline demo dataset — not sourced from a live government system. See DATA_MODE in the README.
      </TooltipContent>
    </Tooltip>
  );
}

export function ModelBadge({ model, version }: { model: string; version: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="cursor-help text-[10px] text-muted-foreground">
          {model}@{version}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        Demo inference stub — not a benchmarked model. Output is illustrative, not a ground-truth detection.
      </TooltipContent>
    </Tooltip>
  );
}
