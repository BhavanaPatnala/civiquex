import Link from "next/link";
import { CheckCircle2, Circle, MapPin, ShieldCheck, Video } from "lucide-react";
import { cn, formatDateTime, titleCase } from "@/lib/utils";
import { deriveTriage, evidenceScoreOf, verificationChecklist, TRIAGE_LABEL, type Triage } from "@/lib/presentation/triage";

const TRIAGE_STYLE: Record<Triage, { dot: string; text: string }> = {
  action_ready: { dot: "bg-success", text: "text-success" },
  review_required: { dot: "bg-warning", text: "text-warning" },
  insufficient: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

export interface EvidenceCardIncident {
  id: string;
  publicId: string;
  incidentType: string;
  ruleVerdict: string;
  evidenceConfidenceOverall: number;
  evidenceConfidenceBreakdown: { visual: number; location: number; temporal: number; rule: number; scene: number; corroboration: number };
  recurring: boolean;
  observationCount: number;
  location: { address: string } | null;
  roadSegment: { name: string } | null;
  createdAt: string;
  thumbnail?: { kind: string; url: string } | null;
}

function EvidenceThumbnail({ thumbnail }: { thumbnail: EvidenceCardIncident["thumbnail"] }) {
  // Demo-seeded/simulated observations carry synthetic media refs with no
  // real bytes behind them — the API only ever sends a thumbnail when it
  // found a genuine "/api/media/..." ref, so a present thumbnail is always
  // safe to render here (no separate honesty check needed on this side).
  if (!thumbnail) {
    return (
      <div className="mx-5 mt-4 flex h-32 items-center justify-center rounded-lg bg-muted/70">
        <ShieldCheck className="h-5 w-5 text-muted-foreground/50" />
      </div>
    );
  }
  if (thumbnail.kind === "video") {
    return (
      <div className="relative mx-5 mt-4 h-32 overflow-hidden rounded-lg bg-black">
        <video src={thumbnail.url} muted preload="metadata" className="h-full w-full object-cover" />
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          <Video className="h-3 w-3" /> Video
        </span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={thumbnail.url} alt="Evidence" className="mx-5 mt-4 h-32 w-full rounded-lg object-cover" />
  );
}

export function EvidenceCard({
  incident,
  href,
  dense = false,
  showScore = true,
}: {
  incident: EvidenceCardIncident;
  href: string;
  dense?: boolean;
  showScore?: boolean;
}) {
  const triage = deriveTriage(incident.ruleVerdict, incident.evidenceConfidenceOverall);
  const style = TRIAGE_STYLE[triage];
  const checklist = verificationChecklist(incident.evidenceConfidenceBreakdown);
  const place = incident.roadSegment?.name ?? incident.location?.address ?? "Location unavailable";

  return (
    <Link
      href={href}
      className="group flex animate-in flex-col overflow-hidden rounded-xl border border-border bg-card fade-in slide-in-from-bottom-1 duration-300 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40 active:translate-y-0 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <p className="text-[13px] font-medium tracking-tight text-foreground">{titleCase(incident.incidentType)}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{incident.publicId}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className={cn("flex items-center gap-1.5 text-[11px] font-medium", style.text)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} aria-hidden />
            {TRIAGE_LABEL[triage]}
          </span>
          {showScore && <span className="text-[10px] tabular-nums text-muted-foreground">{evidenceScoreOf(incident.evidenceConfidenceOverall)}/100</span>}
        </div>
      </div>

      <EvidenceThumbnail thumbnail={incident.thumbnail} />

      <div className="flex flex-col gap-1 px-5 pt-4 text-[13px]">
        <div className="flex items-center gap-1.5 text-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{place}</span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground">
          <span>{formatDateTime(incident.createdAt)}</span>
        </div>
      </div>

      {!dense && (
        <div className="flex flex-col gap-1 border-t border-border px-5 pb-2 pt-4 text-[12px]">
          {checklist.slice(0, 4).map((item) => (
            <div key={item.label} className={cn("flex items-center gap-1.5", item.passed ? "text-foreground" : "text-muted-foreground")}>
              {item.passed ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> : <Circle className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{item.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between px-5 pb-5 pt-2">
        <span className="text-[12px] text-muted-foreground">
          {incident.observationCount} recording{incident.observationCount === 1 ? "" : "s"}
          {incident.recurring && " · recurring location"}
        </span>
        <span className="text-[13px] font-medium text-primary group-hover:underline">View evidence →</span>
      </div>
    </Link>
  );
}
