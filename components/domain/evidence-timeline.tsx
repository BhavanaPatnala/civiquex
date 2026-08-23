"use client";

import { useState } from "react";
import { Video, ImageIcon, Radio, Smartphone, Car, ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

export interface EvidenceObservation {
  linkId: string;
  correlationScore: number;
  correlationFactors: Record<string, number>;
  addedAt: string;
  observation: {
    id: string;
    sourceType: string;
    capturedAt: string;
    lat: number;
    lng: number;
    orientationDeg: number | null;
    detections: { label: string; confidence: number }[];
    visionModel: string;
    visionModelVersion: string;
    media: { id: string; kind: string; url: string; facesBlurred: boolean; encrypted: boolean; retentionUntil: string } | null;
    vehicleFingerprint: string | null;
    vehicle: { typeClass: string; colorClass: string } | null;
  };
}

const SOURCE_ICON: Record<string, typeof Smartphone> = {
  CITIZEN: Smartphone,
  DASHCAM: Car,
  AUTHORIZED_SENSOR: Radio,
};

function MediaPreview({ media }: { media: EvidenceObservation["observation"]["media"] }) {
  if (!media) {
    return <div className="flex h-40 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">No media attached</div>;
  }
  // Only /api/media/... references point at an actual stored file. Anything
  // else (seeded "demo-media://..." refs, the demo simulation stream's
  // synthetic refs) is a placeholder with no real bytes behind it — render
  // an honest placeholder instead of a broken <video>/<img> element.
  if (!media.url.startsWith("/api/media/")) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-muted/60 text-center">
        {media.kind === "video" ? <Video className="h-5 w-5 text-muted-foreground" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
        <p className="px-4 text-[11px] text-muted-foreground">Demo evidence — media file not stored for this observation. AI annotations below are real pipeline output.</p>
      </div>
    );
  }
  if (media.kind === "video") {
    return <video src={media.url} controls className="h-40 w-full rounded-md bg-black object-contain" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={media.url} alt="Evidence" className="h-40 w-full rounded-md object-cover" />;
}

export function EvidenceTimeline({ items }: { items: EvidenceObservation[] }) {
  const [expanded, setExpanded] = useState<string | null>(items[0]?.linkId ?? null);

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, idx) => {
        const Icon = SOURCE_ICON[item.observation.sourceType] ?? Smartphone;
        const isOpen = expanded === item.linkId;
        return (
          <Card key={item.linkId} className="overflow-hidden">
            <button
              className="flex w-full items-center gap-3 p-3 text-left"
              onClick={() => setExpanded(isOpen ? null : item.linkId)}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Recording {idx + 1}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {item.observation.sourceType.replace("_", " ").toLowerCase()}
                  </Badge>
                  {idx > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      Confirms the same event
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(item.observation.capturedAt)}</p>
              </div>
              {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {isOpen && (
              <div className="flex flex-col gap-3 border-t border-border p-3">
                <MediaPreview media={item.observation.media} />
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.observation.detections.map((d, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      {d.label.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
                {item.observation.media && (
                  <p className="text-[11px] text-muted-foreground">
                    Unrelated faces and plates in this recording are automatically blurred before it is shown outside the reviewing authority.
                  </p>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
