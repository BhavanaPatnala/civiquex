"use client";

import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";

const RING_RADIUS = 34;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * An iOS-camera-style shutter control: a white ring button with a red
 * indicator inside. In "record" mode it toggles start/stop and shows a
 * progress ring counting down to maxSeconds. In "capture" mode it's a
 * single-tap still-photo shutter. Either way the affordance is unambiguous
 * at a glance — the thing every "video record does not have a proper start
 * stop" complaint is about.
 */
export function ShutterButton({
  mode,
  recording = false,
  elapsedSeconds = 0,
  maxSeconds,
  disabled,
  onClick,
  label,
}: {
  mode: "record" | "capture";
  recording?: boolean;
  elapsedSeconds?: number;
  maxSeconds?: number;
  disabled?: boolean;
  onClick: () => void;
  label?: string;
}) {
  const progress = mode === "record" && maxSeconds ? Math.min(1, elapsedSeconds / maxSeconds) : 0;
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label ?? (mode === "record" ? (recording ? "Stop recording" : "Start recording") : "Capture photo")}
        className={cn(
          "group relative flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
        )}
      >
        {mode === "record" && (
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
            {recording && (
              <circle
                cx="38"
                cy="38"
                r={RING_RADIUS}
                fill="none"
                stroke="#ef4444"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                className="transition-[stroke-dashoffset] duration-200 ease-linear"
              />
            )}
          </svg>
        )}
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.35)] ring-1 ring-black/5 transition-all duration-200 group-active:shadow-none">
          {mode === "capture" ? (
            <Camera className="h-6 w-6 text-neutral-900" strokeWidth={1.75} />
          ) : recording ? (
            <span className="h-6 w-6 rounded-[7px] bg-red-500 transition-all duration-200" />
          ) : (
            <span className="h-[52px] w-[52px] rounded-full bg-red-500 transition-all duration-200" />
          )}
        </span>
      </button>
      {mode === "record" && (
        <span className={cn("font-mono text-xs tabular-nums text-white/90 transition-opacity", recording ? "opacity-100" : "opacity-0")}>
          0:{String(Math.floor(elapsedSeconds)).padStart(2, "0")}
          {maxSeconds ? ` / 0:${String(maxSeconds).padStart(2, "0")}` : ""}
        </span>
      )}
    </div>
  );
}

/** Small pill shown while a still-photo shutter is capturing, for immediate feedback. */
export function ShutterFlash({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 bg-white transition-opacity duration-150",
        active ? "opacity-70" : "opacity-0"
      )}
    />
  );
}
