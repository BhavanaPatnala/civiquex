"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ImageUp,
  Loader2,
  MapPin,
  Navigation,
  RotateCcw,
  ShieldCheck,
  VideoOff,
  Wifi,
  X,
} from "lucide-react";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ShutterButton } from "@/components/domain/shutter-button";
import { useSession } from "@/lib/client/useSession";
import { useRoadPatrolDetector, type PatrolFrameResult } from "@/lib/client/useRoadPatrolDetector";
import { apiPost, apiGet, ApiError } from "@/lib/client/api";
import { prepareMediaForUpload } from "@/lib/client/uploadMedia";
import { useToast } from "@/components/ui/toast-provider";
import { cn, formatPercent } from "@/lib/utils";

interface ReverseGeocodeResult {
  displayName: string;
  road: string | null;
  suburb: string | null;
  city: string | null;
}

interface ContractMatchView {
  tenderNo: string;
  contractorName: string;
  contractorEmail: string;
  officerName: string;
  officerEmail: string;
  roadName: string;
  score: number;
  matchedBy: string[];
  activeWarranty: boolean;
}

interface CandidateResult {
  id: string;
  lat: number;
  lng: number;
  roadName: string | null;
  mediaUrl: string;
  contractMatch: ContractMatchView | null;
}

const ANOMALY_THRESHOLD = 0.35;
const GEOCODE_MOVE_METERS = 40;
const CHENNAI_FALLBACK = { lat: 13.045, lng: 80.24 };

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export default function PatrolPage() {
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement>(null!);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const uploadImgRef = useRef<HTMLImageElement>(null);
  const uploadOverlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastGeocodeAtRef = useRef<{ lat: number; lng: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const detector = useRoadPatrolDetector(videoRef);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "locating" | "live" | "denied" | "unavailable">("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [manualCoords, setManualCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geocode, setGeocode] = useState<ReverseGeocodeResult | null>(null);
  const [notes, setNotes] = useState("");
  const [candidate, setCandidate] = useState<CandidateResult | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState<string | null>(null);
  const [sessionCandidates, setSessionCandidates] = useState<CandidateResult[]>([]);

  // --- Fallback: analyze an uploaded photo instead of the live camera ----
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<Blob | null>(null);
  const [uploadResult, setUploadResult] = useState<PatrolFrameResult | null>(null);
  const [analyzingUpload, setAnalyzingUpload] = useState(false);

  const effectiveCoords = coords ?? manualCoords;

  // --- Camera -----------------------------------------------------------
  async function startCamera() {
    setCameraError(null);
    setCameraLoading(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-media-devices");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
      streamRef.current = stream;
      // Once we actually have a live stream, the feed is on — commit to
      // that state immediately. video.play() can reject on some mobile
      // browsers even when the element is already rendering frames (a race
      // with a second, near-simultaneous permission prompt for GPS is a
      // known trigger) — treat that as best-effort, not a hard failure, so
      // a harmless play() rejection can never leave the UI stuck showing
      // "camera off" over a feed that is in fact live.
      setCameraOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((err) => console.warn("video.play() rejected (stream is still live):", err));
      }
    } catch {
      setCameraOn(false);
      setCameraError("Camera unavailable — check your browser's site permissions, or upload a photo below instead.");
    } finally {
      setCameraLoading(false);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    detector.stop();
  }

  // --- Real, continuous GPS ----------------------------------------------
  function startGps() {
    if (!("geolocation" in navigator)) {
      setGpsStatus("unavailable");
      return;
    }
    setGpsStatus("locating");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsStatus("live");
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
      () => setGpsStatus("denied"),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }

  function stopGps() {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
  }

  // Auto-start scanning the moment both the camera feed and the real model are ready — no extra click required.
  useEffect(() => {
    if (cameraOn && detector.modelStatus === "ready" && !detector.scanning) detector.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, detector.modelStatus]);

  // Reverse-geocode only when we've moved meaningfully, respecting Nominatim's rate policy.
  useEffect(() => {
    if (!effectiveCoords) return;
    const last = lastGeocodeAtRef.current;
    if (last && haversine(last, effectiveCoords) < GEOCODE_MOVE_METERS) return;
    lastGeocodeAtRef.current = { lat: effectiveCoords.lat, lng: effectiveCoords.lng };
    apiGet<ReverseGeocodeResult>(`/api/geocode/reverse?lat=${effectiveCoords.lat}&lng=${effectiveCoords.lng}`)
      .then(setGeocode)
      .catch(() => setGeocode(null));
  }, [effectiveCoords]);

  useEffect(
    () => () => {
      stopCamera();
      stopGps();
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // --- Draw the real detection overlay live on top of the video ---------
  // Whenever the camera isn't on, the overlay is force-cleared so a stale
  // bounding box from a previous session can never linger and contradict
  // the "camera is off" state shown underneath it.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!cameraOn) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const video = videoRef.current;
    if (!video || !detector.lastResult) return;
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
    drawDetections(ctx, canvas.width, canvas.height, detector.lastResult);
  }, [detector.lastResult, cameraOn]);

  function drawDetections(ctx: CanvasRenderingContext2D, width: number, height: number, r: PatrolFrameResult) {
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 2;
    ctx.font = "12px ui-sans-serif, system-ui";
    for (const d of r.objectDetections) {
      const [x, y, w, h] = d.bbox;
      ctx.strokeStyle = "#3b82f6";
      ctx.strokeRect(x * width, y * height, w * width, h * height);
      ctx.fillStyle = "#3b82f6";
      ctx.fillText(`${d.label} ${(d.confidence * 100).toFixed(0)}%`, x * width + 3, Math.max(12, y * height - 4));
    }
    if (r.anomaly.bbox) {
      const [x, y, w, h] = r.anomaly.bbox;
      ctx.strokeStyle = r.anomaly.score >= ANOMALY_THRESHOLD ? "#dc2626" : "#f59e0b";
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(x * width, y * height, w * width, h * height);
      ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText(`anomaly ${(r.anomaly.score * 100).toFixed(0)}%`, x * width + 3, y * height + h * height + 14);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Unsupported file", description: "Choose a photo (JPEG, PNG, or WebP).", variant: "destructive" });
      e.target.value = "";
      return;
    }
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadFile(file);
    setUploadPreview(URL.createObjectURL(file));
    setUploadResult(null);
    setAnalyzingUpload(true);
    try {
      const outcome = await detector.analyzeImageBlob(file);
      if (outcome.ok) {
        setUploadResult(outcome.result);
      } else {
        const messages: Record<string, string> = {
          "model-not-ready": "The detection model is still loading — wait a few seconds and try again.",
          "decode-failed": "This file couldn't be read as an image. Try a different photo.",
          "canvas-unavailable": "Your browser couldn't process this image. Try a different browser.",
        };
        toast({ title: "Couldn't analyze this photo", description: messages[outcome.reason], variant: "destructive" });
      }
    } finally {
      setAnalyzingUpload(false);
    }
  }

  useEffect(() => {
    const canvas = uploadOverlayRef.current;
    const img = uploadImgRef.current;
    if (!canvas || !img || !uploadResult) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;
    drawDetections(ctx, canvas.width, canvas.height, uploadResult);
  }, [uploadResult, uploadPreview]);

  async function submitCandidate(mediaBlob: Blob, frame: PatrolFrameResult) {
    if (!effectiveCoords) {
      toast({ title: "Location required", description: "Enable GPS or enter coordinates manually before capturing.", variant: "destructive" });
      return;
    }
    setCapturing(true);
    try {
      const prepared = await prepareMediaForUpload(mediaBlob, mediaBlob.type || "image/jpeg");
      const res = await apiPost<CandidateResult>("/api/patrol/detections", {
        mediaBase64: prepared.mediaBase64,
        mediaBlobUrl: prepared.mediaBlobUrl,
        mediaContentHash: prepared.mediaContentHash,
        mediaType: prepared.mediaType,
        lat: effectiveCoords.lat,
        lng: effectiveCoords.lng,
        gpsAccuracyMeters: coords?.accuracy,
        capturedAt: new Date().toISOString(),
        notes: notes || undefined,
        detectionSummary: {
          objectDetections: frame.objectDetections,
          anomalyScore: frame.anomaly.score,
          anomalyBbox: frame.anomaly.bbox,
          inferenceMs: frame.inferenceMs,
          objectModel: detector.modelInfo.objectModel,
          anomalyModel: detector.modelInfo.anomalyModel,
          framesAnalyzed: detector.framesAnalyzed,
        },
      });
      setCandidate(res);
      setSessionCandidates((prev) => [res, ...prev]);
      toast({ title: "Candidate captured", description: res.roadName ? `Matched to ${res.roadName}` : "Location matched via GPS", variant: "success" });
    } catch (err) {
      toast({ title: "Capture failed", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setCapturing(false);
    }
  }

  async function handleCaptureLive() {
    if (!detector.lastResult) return;
    const blob = await detector.captureFrameBlob();
    if (!blob) {
      toast({ title: "Could not capture the current frame", variant: "destructive" });
      return;
    }
    await submitCandidate(blob, detector.lastResult);
  }

  async function handleCaptureUpload() {
    if (!uploadFile || !uploadResult) return;
    await submitCandidate(uploadFile, uploadResult);
  }

  async function handleConfirm(id: string) {
    setConfirmBusy(id);
    try {
      const res = await apiPost<{ incidentId: string }>(`/api/patrol/detections/${id}/confirm`);
      toast({ title: "Incident created", variant: "success" });
      router.push(`/incidents/${res.incidentId}`);
    } catch (err) {
      toast({ title: "Could not confirm", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setConfirmBusy(null);
    }
  }

  async function handleDismiss(id: string) {
    setConfirmBusy(id);
    try {
      await apiPost(`/api/patrol/detections/${id}/dismiss`);
      setCandidate(null);
      setSessionCandidates((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      toast({ title: "Could not dismiss", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setConfirmBusy(null);
    }
  }

  if (!sessionLoading && !user) {
    return (
      <PageContainer className="flex flex-col items-center gap-3 py-24 text-center">
        <ShieldCheck className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">Sign in to use AI Road Patrol</p>
        <Button size="sm" onClick={() => router.push("/login")}>
          Go to sign in
        </Button>
      </PageContainer>
    );
  }

  const anomalyLive = (uploadResult ?? detector.lastResult)?.anomaly.score ?? 0;
  const flagged = anomalyLive >= ANOMALY_THRESHOLD;
  const activeResult = uploadFile ? uploadResult : detector.lastResult;
  const canCapture = uploadFile ? !!uploadResult && !analyzingUpload : !!detector.lastResult;
  const gpsUnavailable = gpsStatus === "denied" || gpsStatus === "unavailable";

  return (
    <>
      <PageHeader
        title="AI Road Patrol"
        description="Real GPS + live in-browser AI detection, matched against the road-contract registry — modeled on real citizen pothole-hunting tools"
        actions={
          <Badge variant="outline" className="gap-1.5 border-dashed text-[10px] uppercase tracking-wide text-muted-foreground">
            Contract registry: demo data
          </Badge>
        }
      />
      <PageContainer className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          {/* Live camera + overlay */}
          <Card className="overflow-hidden xl:col-span-2">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Driving mode — live feed</CardTitle>
                <CardDescription>Mount the phone facing the road; detection starts automatically once the camera is on</CardDescription>
              </div>
              {detector.scanning && (
                <Badge variant="success" className="gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
                </Badge>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!uploadFile ? (
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-neutral-950 sm:aspect-video">
                  <video ref={videoRef} muted playsInline className={cn("h-full w-full object-cover transition-opacity", cameraOn ? "opacity-100" : "opacity-0")} />
                  <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

                  <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white backdrop-blur-sm">
                    <Navigation className="h-3 w-3 shrink-0" />
                    {gpsStatus === "locating" && <span>Locating…</span>}
                    {gpsStatus === "live" && coords && <span>±{Math.round(coords.accuracy)}m</span>}
                    {gpsUnavailable && <span className="text-amber-300">GPS unavailable</span>}
                    {gpsStatus === "idle" && <span className="text-white/60">GPS off</span>}
                  </div>

                  {!cameraOn && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                      {cameraLoading ? (
                        <Loader2 className="h-6 w-6 animate-spin text-white/70" />
                      ) : (
                        <>
                          <VideoOff className="h-7 w-7 text-white/50" />
                          {cameraError && <p className="max-w-xs text-xs text-white/70">{cameraError}</p>}
                          <Button
                            size="sm"
                            onClick={async () => {
                              await startCamera();
                              startGps();
                            }}
                          >
                            Start driving mode
                          </Button>
                        </>
                      )}
                    </div>
                  )}

                  {cameraOn && flagged && (
                    <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-critical/90 px-3 py-1 text-xs font-medium text-critical-foreground shadow-lg animate-in fade-in-0">
                      <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Road-surface anomaly candidate
                    </div>
                  )}

                  {cameraOn && (
                    <>
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
                      <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-6">
                        <button
                          onClick={() => {
                            stopCamera();
                            stopGps();
                          }}
                          aria-label="Stop driving mode"
                          className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-transform active:scale-90"
                        >
                          <X className="h-5 w-5" />
                        </button>
                        <ShutterButton mode="capture" disabled={!canCapture || capturing} onClick={handleCaptureLive} label="Capture & match now" />
                        <div className="w-11" />
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-neutral-950 sm:aspect-video">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img ref={uploadImgRef} src={uploadPreview ?? undefined} alt="Uploaded road photo" className="h-full w-full object-contain" />
                  <canvas ref={uploadOverlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
                  {analyzingUpload && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="text-xs">Running real AI detection on this photo…</span>
                    </div>
                  )}
                  {!analyzingUpload && flagged && (
                    <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-critical/90 px-3 py-1 text-xs font-medium text-critical-foreground shadow-lg">
                      <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Road-surface anomaly candidate
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-white/90 hover:bg-white"
                      onClick={() => {
                        if (uploadPreview) URL.revokeObjectURL(uploadPreview);
                        setUploadFile(null);
                        setUploadPreview(null);
                        setUploadResult(null);
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Choose another
                    </Button>
                    <Button size="sm" onClick={handleCaptureUpload} disabled={!canCapture || capturing}>
                      {capturing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Capture &amp; match now
                    </Button>
                  </div>
                </div>
              )}

              {!cameraOn && !uploadFile && (
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary">
                  <ImageUp className="h-4 w-4" />
                  No camera? Upload a road photo instead — same real AI detection
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />
                </label>
              )}

              {!coords && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2.5 text-xs">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">{gpsUnavailable ? "GPS unavailable" : "No location yet"} — enter coordinates manually{gpsStatus === "idle" ? ", or" : ":"}</span>
                  {gpsStatus === "idle" && (
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={startGps}>
                      Use my GPS
                    </Button>
                  )}
                  <Input
                    type="number"
                    step="0.0001"
                    placeholder="lat"
                    className="h-7 w-24 text-xs"
                    onChange={(e) => setManualCoords({ lat: Number(e.target.value) || CHENNAI_FALLBACK.lat, lng: manualCoords?.lng ?? CHENNAI_FALLBACK.lng })}
                  />
                  <Input
                    type="number"
                    step="0.0001"
                    placeholder="lng"
                    className="h-7 w-24 text-xs"
                    onChange={(e) => setManualCoords({ lat: manualCoords?.lat ?? CHENNAI_FALLBACK.lat, lng: Number(e.target.value) || CHENNAI_FALLBACK.lng })}
                  />
                </div>
              )}

              <Input placeholder="Optional note (e.g. road name if you know it) — improves contract matching" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </CardContent>
          </Card>

          {/* AI Analysis Proof */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary" /> AI analysis proof
              </CardTitle>
              <CardDescription>Live, real numbers from real models — nothing here is simulated</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Object detection model</p>
                <p className="font-mono text-xs">{detector.modelInfo.objectModel}</p>
                <Badge variant={detector.modelStatus === "ready" ? "success" : detector.modelStatus === "loading" ? "outline" : "muted"} className="mt-1 text-[10px]">
                  {detector.modelStatus === "ready" ? "Loaded — real TensorFlow.js neural network" : detector.modelStatus === "loading" ? "Loading model…" : detector.modelStatus === "unavailable" ? "Unavailable" : "Idle"}
                </Badge>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Road-anomaly heuristic</p>
                <p className="font-mono text-xs">{detector.modelInfo.anomalyModel}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Real Sobel edge-magnitude analysis on the captured pixels, not a trained classifier</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-md bg-muted p-2">
                  <div className="text-lg font-semibold tabular-nums">{detector.framesAnalyzed}</div>
                  <div className="text-[10px] text-muted-foreground">Frames analyzed</div>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <div className="text-lg font-semibold tabular-nums">{detector.avgInferenceMs > 0 ? `${detector.avgInferenceMs.toFixed(0)}ms` : "—"}</div>
                  <div className="text-[10px] text-muted-foreground">Avg. inference time</div>
                </div>
              </div>

              {activeResult && (
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Last scan</p>
                  <div className="flex flex-col gap-1">
                    {activeResult.objectDetections.length === 0 && <p className="text-xs text-muted-foreground">No objects detected this frame</p>}
                    {activeResult.objectDetections.map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="capitalize">{d.label}</span>
                        <span className="tabular-nums text-muted-foreground">{formatPercent(d.confidence)}</span>
                      </div>
                    ))}
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className={cn("font-medium", flagged && "text-critical")}>Road anomaly score</span>
                      <span className={cn("tabular-nums", flagged && "text-critical font-semibold")}>{formatPercent(anomalyLive)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t border-border pt-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Navigation className="h-3 w-3" /> Real GPS
                </p>
                {gpsStatus === "idle" && !manualCoords && <p className="text-xs text-muted-foreground">Not started</p>}
                {gpsStatus === "locating" && <p className="text-xs text-muted-foreground">Acquiring signal…</p>}
                {gpsStatus === "live" && coords && (
                  <p className="text-xs">
                    {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} <span className="text-muted-foreground">(±{Math.round(coords.accuracy)}m)</span>
                  </p>
                )}
                {gpsUnavailable && manualCoords && (
                  <p className="text-xs">
                    {manualCoords.lat.toFixed(4)}, {manualCoords.lng.toFixed(4)} <span className="text-muted-foreground">(manual)</span>
                  </p>
                )}
                {gpsUnavailable && !manualCoords && <p className="text-xs text-destructive">Location permission unavailable</p>}
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {geocode ? geocode.displayName : "Road name will appear once GPS is live"}
                </p>
                {geocode && (
                  <Badge variant="outline" className="mt-1 gap-1 text-[9px] text-muted-foreground">
                    <Wifi className="h-2.5 w-2.5" /> OpenStreetMap Nominatim (live, free)
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Latest candidate result */}
        {candidate && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-success" /> Candidate captured
              </CardTitle>
              <CardDescription>{candidate.roadName ?? `${candidate.lat.toFixed(5)}, ${candidate.lng.toFixed(5)}`}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={candidate.mediaUrl} alt="Captured road surface" className="h-40 w-full rounded-md object-cover sm:w-56" />
              <div className="flex-1">
                {candidate.contractMatch ? (
                  <div className="flex flex-col gap-1.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={candidate.contractMatch.activeWarranty ? "critical" : "muted"}>
                        {candidate.contractMatch.activeWarranty ? "Active warranty — contractor liable" : "Warranty lapsed"}
                      </Badge>
                      <Badge variant="outline">{formatPercent(candidate.contractMatch.score / 100)} match</Badge>
                    </div>
                    <p>
                      <span className="text-muted-foreground">Contractor:</span> {candidate.contractMatch.contractorName}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Responsible officer:</span> {candidate.contractMatch.officerName}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Tender no:</span> <span className="font-mono text-xs">{candidate.contractMatch.tenderNo}</span>
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {candidate.contractMatch.matchedBy.map((m) => (
                        <Badge key={m} variant="outline" className="text-[10px]">
                          matched by: {m}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No contract on file for this location in the demo registry — the incident can still be filed through the normal authority routing.</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => handleConfirm(candidate.id)} disabled={confirmBusy !== null}>
                    {confirmBusy === candidate.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Confirm as incident
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleDismiss(candidate.id)} disabled={confirmBusy !== null}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {sessionCandidates.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle>This session</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {sessionCandidates.map((c) => (
                <button key={c.id} onClick={() => setCandidate(c)} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left text-xs hover:bg-accent">
                  <span>{c.roadName ?? `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`}</span>
                  <span className="text-muted-foreground">{c.contractMatch ? c.contractMatch.contractorName : "No contract match"}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}
      </PageContainer>
    </>
  );
}
