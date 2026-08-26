"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  ImageUp,
  Loader2,
  MapPin,
  RotateCcw,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShutterButton } from "@/components/domain/shutter-button";
import { useGeolocation } from "@/lib/client/useGeolocation";
import { useSession } from "@/lib/client/useSession";
import { useRoadPatrolDetector } from "@/lib/client/useRoadPatrolDetector";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";
import {
  cancelUploadSession,
  checkForResumableUpload,
  MediaProcessingError,
  prepareMediaForUpload,
  UploadCancelledError,
  type ResumableUpload,
} from "@/lib/client/uploadMedia";
import { getPendingBlob } from "@/lib/client/uploadStore";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast-provider";
import { INCIDENT_TYPES } from "@/lib/types";
import { cn, titleCase, formatDateTime } from "@/lib/utils";
import { deriveTriage, evidenceScoreOf, TRIAGE_LABEL, type Triage } from "@/lib/presentation/triage";
import { describeCaptured, vehicleLine } from "@/lib/presentation/plainLanguage";

/** Grabs a single decoded frame from a recorded video blob, for running real object detection on a captured clip the same way we do for a photo. */
function extractVideoFrameBlob(videoBlob: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(videoBlob);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    const cleanup = () => URL.revokeObjectURL(url);
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx || !canvas.width) {
        cleanup();
        resolve(null);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (b) => {
          cleanup();
          resolve(b);
        },
        "image/jpeg",
        0.9
      );
    };
    video.onerror = () => {
      cleanup();
      resolve(null);
    };
  });
}

type Step = "type" | "capture" | "processing" | "review";

interface IncidentResult {
  id: string;
  publicId: string;
  incidentType: string;
  riskLevel: string;
  evidenceConfidenceOverall: number;
  evidenceConfidenceBreakdown: { visual: number; location: number; temporal: number; rule: number; scene: number; corroboration: number };
  ruleVerdict: string;
  ruleReasoning: string;
  location: { address: string } | null;
  roadSegment: { name: string } | null;
  observations: {
    observation: {
      capturedAt: string;
      vehicle: { typeClass: string; colorClass: string } | null;
      visionModel: string;
      detections: { label: string; confidence: number }[];
    };
  }[];
}

const CHENNAI_FALLBACK = { lat: 13.045, lng: 80.24 };
const MAX_RECORD_SECONDS = 10;

// A resumable upload only saves the raw bytes (see lib/client/uploadStore.ts)
// — resuming the actual submission also needs the category/location/time
// that upload belonged to, which is ordinary React state and doesn't
// survive a reload on its own. This is that context, keyed to the same
// content hash so it's only ever offered back for the matching upload.
const DRAFT_KEY = "civiquex-report-draft";
interface ReportDraft {
  contentHash: string;
  mimeType: string;
  incidentType: string;
  capturedAt: string;
  lat: number;
  lng: number;
  gpsAccuracyMeters?: number;
}
function saveDraft(draft: ReportDraft) {
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}
function readDraft(): ReportDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as ReportDraft) : null;
  } catch {
    return null;
  }
}
function clearDraft() {
  window.localStorage.removeItem(DRAFT_KEY);
}

export default function ReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportPageInner />
    </Suspense>
  );
}

function ReportPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const captureMode: "video" | "photo" = searchParams.get("mode") === "photo" ? "photo" : "video";
  const { user, loading: sessionLoading } = useSession();
  const { toast } = useToast();
  const geo = useGeolocation();

  const [step, setStep] = useState<Step>("type");
  const [incidentType, setIncidentType] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [result, setResult] = useState<{ observationId: string; incidentId: string; isNewIncident: boolean } | null>(null);
  const [incident, setIncident] = useState<IncidentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [processingLabel, setProcessingLabel] = useState("Running AI detection on your evidence…");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [resumable, setResumable] = useState<ResumableUpload | null>(null);
  const uploadSessionRef = useRef<{ sessionId: string; contentHash: string } | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Deferred: loading TensorFlow.js is heavy enough to visibly compete with
  // the UI thread, and this page's very first screen is just picking a
  // category — nothing here needs the model yet. It starts loading once the
  // reporter moves on to the capture step, so it's warmed up by the time
  // they actually take a photo, without janking the type-selection tap.
  const detector = useRoadPatrolDetector(videoRef, { autoLoad: false });
  useEffect(() => {
    if (step !== "type") detector.loadModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An interrupted large upload leaves its bytes in IndexedDB and an
  // IN_PROGRESS session on the server — offer to pick it back up instead of
  // silently discarding real, already-uploaded progress.
  useEffect(() => {
    checkForResumableUpload().then((found) => {
      if (!found) return;
      const draft = readDraft();
      if (draft?.contentHash === found.contentHash) setResumable(found);
    });
  }, []);

  async function startCamera() {
    setCameraError(null);
    setCameraLoading(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-media-devices");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      // Commit to "camera on" as soon as the stream exists; video.play()
      // rejecting on some mobile browsers (a known race with a second,
      // near-simultaneous permission prompt) must never leave the UI stuck
      // showing "camera off" over a feed that is actually live.
      setCameraOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((err) => console.warn("video.play() rejected (stream is still live):", err));
      }
    } catch {
      setCameraOn(false);
      setCameraError("Camera unavailable — check your browser's site permissions, or use \"Choose from device\" below instead.");
    } finally {
      setCameraLoading(false);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current, { mimeType: "video/webm" });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const recorded = new Blob(chunksRef.current, { type: "video/webm" });
      setBlob(recorded);
      setPreviewUrl(URL.createObjectURL(recorded));
      stopCamera();
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    setRecordSeconds(0);
    timerRef.current = setInterval(() => {
      setRecordSeconds((s) => {
        if (s + 1 >= MAX_RECORD_SECONDS) {
          stopRecording();
          return MAX_RECORD_SECONDS;
        }
        return s + 1;
      });
    }, 1000);
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    setRecording(false);
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (still) => {
        if (!still) return;
        setBlob(still);
        setPreviewUrl(URL.createObjectURL(still));
        stopCamera();
      },
      "image/jpeg",
      0.92
    );
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBlob(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function processEvidence(overrides?: { capturedAt: Date; lat: number; lng: number; gpsAccuracyMeters?: number; blob: Blob; incidentType: string }) {
    // React state updates are async — a caller that just called setBlob()/
    // setIncidentType() in the same tick (see resumeUpload()) cannot rely on
    // the `blob`/`incidentType` closure below reflecting them yet, so an
    // override always wins over component state rather than falling back to
    // a stale read of it.
    const activeBlob = overrides?.blob ?? blob;
    const activeIncidentType = overrides?.incidentType ?? incidentType;
    if (!activeIncidentType || !activeBlob) return;
    if (!user) {
      setError("Sign in to submit an observation.");
      return;
    }
    setStep("processing");
    setError(null);
    setUploadProgress(null);
    const coords = overrides ? { lat: overrides.lat, lng: overrides.lng } : geo.coords ?? CHENNAI_FALLBACK;
    const capturedAt = overrides?.capturedAt ?? new Date();
    const gpsAccuracyMeters = overrides?.gpsAccuracyMeters ?? geo.coords?.accuracy;

    try {
      // Real detection first: run the actual TensorFlow.js model (COCO-SSD)
      // plus the road-surface anomaly scan on the real captured frame — the
      // same real pipeline AI Road Patrol uses — so the result reflects what
      // is genuinely in the photo/video, not just the category picked above.
      setProcessingLabel("Running AI detection on your evidence…");
      const isVideo = activeBlob.type.startsWith("video");
      const frameForDetection = isVideo ? await extractVideoFrameBlob(activeBlob) : activeBlob;
      const analysis = frameForDetection ? await detector.analyzeImageBlob(frameForDetection) : ({ ok: false, reason: "decode-failed" } as const);

      let detectionSummary:
        | {
            objectDetections: { label: string; confidence: number; bbox: [number, number, number, number] }[];
            anomalyScore: number;
            anomalyBbox: [number, number, number, number] | null;
            objectModel: string;
            anomalyModel: string;
          }
        | undefined;

      if (analysis.ok) {
        detectionSummary = {
          objectDetections: analysis.result.objectDetections,
          anomalyScore: analysis.result.anomaly.score,
          anomalyBbox: analysis.result.anomaly.bbox,
          objectModel: detector.modelInfo.objectModel,
          anomalyModel: detector.modelInfo.anomalyModel,
        };
      } else {
        toast({
          title: "Live AI detection unavailable",
          description: "Continuing with a lower-confidence fallback — try again once the detector finishes loading for a more accurate result.",
          variant: "destructive",
        });
      }

      setProcessingLabel(isVideo ? "Uploading video evidence…" : "Correlating, checking applicable rules, and computing evidence…");
      const mimeType = activeBlob.type || "image/jpeg";

      uploadAbortRef.current = new AbortController();
      const prepared = await prepareMediaForUpload(activeBlob, mimeType, {
        onHashReady: (contentHash) =>
          saveDraft({ contentHash, mimeType, incidentType: activeIncidentType, capturedAt: capturedAt.toISOString(), lat: coords.lat, lng: coords.lng, gpsAccuracyMeters }),
        onProgress: (fraction) => setUploadProgress(fraction),
        onSessionReady: (s) => (uploadSessionRef.current = s),
        signal: uploadAbortRef.current.signal,
      });
      uploadSessionRef.current = null;
      setUploadProgress(null);
      clearDraft();

      setProcessingLabel("Correlating, checking applicable rules, and computing evidence…");
      const res = await apiPost<{ observationId: string; incidentId: string; isNewIncident: boolean }>("/api/observations", {
        mediaBase64: prepared.mediaBase64,
        mediaBlobUrl: prepared.mediaBlobUrl,
        mediaContentHash: prepared.mediaContentHash,
        mediaType: prepared.mediaType,
        incidentTypeGuess: activeIncidentType,
        lat: coords.lat,
        lng: coords.lng,
        capturedAt: capturedAt.toISOString(),
        gpsAccuracyMeters,
        detectionSummary,
      });
      setResult(res);
      const detail = await apiGet<IncidentResult>(`/api/incidents/${res.incidentId}`);
      setIncident(detail);
      setStep("review");
    } catch (err) {
      setUploadProgress(null);
      // An aborted upload can surface either our own UploadCancelledError
      // (checked between parts) or the Blob SDK's own AbortError (an
      // in-flight uploadPart request cut short) — either way, if this was a
      // deliberate Cancel, it's not a failure worth alarming the user about.
      if (err instanceof UploadCancelledError || uploadAbortRef.current?.signal.aborted) {
        setStep("capture");
        return;
      }
      setError(err instanceof ApiError || err instanceof MediaProcessingError ? err.message : "Processing failed — please try again.");
      setStep("capture");
    }
  }

  async function cancelUpload() {
    uploadAbortRef.current?.abort();
    if (uploadSessionRef.current) {
      await cancelUploadSession(uploadSessionRef.current.sessionId, uploadSessionRef.current.contentHash);
      uploadSessionRef.current = null;
    }
    clearDraft();
  }

  async function resumeUpload() {
    if (!resumable) return;
    const draft = readDraft();
    const pendingBlob = await getPendingBlob(resumable.contentHash);
    if (!draft || !pendingBlob) {
      setResumable(null);
      clearDraft();
      return;
    }
    setIncidentType(draft.incidentType);
    setBlob(pendingBlob);
    setResumable(null);
    await processEvidence({
      capturedAt: new Date(draft.capturedAt),
      lat: draft.lat,
      lng: draft.lng,
      gpsAccuracyMeters: draft.gpsAccuracyMeters,
      blob: pendingBlob,
      incidentType: draft.incidentType,
    });
  }

  async function discardResumable() {
    if (resumable) await cancelUploadSession(resumable.sessionId, resumable.contentHash);
    clearDraft();
    setResumable(null);
  }

  async function handleSubmitToAuthority() {
    if (!result) return;
    setSubmitBusy(true);
    try {
      await apiPost(`/api/incidents/${result.incidentId}/submit`);
      toast({ title: "Submitted to authority", variant: "success" });
      router.push(`/incidents/${result.incidentId}`);
    } catch (err) {
      toast({ title: "Could not submit", description: err instanceof ApiError ? err.message : undefined, variant: "destructive" });
    } finally {
      setSubmitBusy(false);
    }
  }

  if (!sessionLoading && !user) {
    return (
      <PageContainer className="flex flex-col items-center gap-3 py-24 text-center">
        <Camera className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">Sign in to report a safety issue</p>
        <p className="max-w-sm text-xs text-muted-foreground">Evidence is tied to an accountable submitter identity internally, even though it&apos;s never shown publicly.</p>
        <Button size="sm" onClick={() => router.push("/login")}>
          Go to sign in
        </Button>
      </PageContainer>
    );
  }

  return (
    <>
      <PageHeader title="Report Safety Issue" description="Observe → capture evidence → let the AI pipeline process it" />
      <PageContainer className="mx-auto flex max-w-2xl flex-col gap-5">
        {resumable && step === "type" && (
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="flex flex-col gap-3 py-4">
              <div>
                <p className="text-sm font-medium">Resume interrupted upload</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  An evidence upload didn&apos;t finish last time — {Math.round(resumable.fractionComplete * 100)}% already made it through. Pick up where it left off instead of recapturing.
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={resumeUpload} disabled={sessionLoading}>
                  {sessionLoading ? "Checking sign-in…" : "Resume upload"}
                </Button>
                <Button size="sm" variant="outline" onClick={discardResumable}>
                  Discard
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "type" && (
          <Card>
            <CardHeader>
              <CardTitle>What did you observe?</CardTitle>
              <CardDescription>Select the category closest to what you saw — the rule engine will determine applicability from context</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {INCIDENT_TYPES.map((t) => (
                  <button
                    key={t.code}
                    onClick={() => {
                      setIncidentType(t.code);
                      setStep("capture");
                      geo.request();
                    }}
                    className="rounded-md border border-border p-3 text-left text-sm font-medium transition-colors hover:border-primary hover:bg-primary/5"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {step === "capture" && incidentType && (
          <Card className="overflow-hidden">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{titleCase(incidentType)}</CardTitle>
                  <CardDescription>
                    {captureMode === "photo" ? "Capture a photo, or choose one from your device" : "Capture 5-10 seconds of video, or choose one from your device"}
                  </CardDescription>
                </div>
                <Button size="icon" variant="ghost" onClick={() => setStep("type")} aria-label="Back to incident type">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!previewUrl && (
                <div className="flex flex-col gap-3">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-neutral-950 sm:aspect-video">
                    <video ref={videoRef} muted playsInline className={cn("h-full w-full object-cover transition-opacity", cameraOn ? "opacity-100" : "opacity-0")} />

                    {/* GPS chip, camera-app style, overlaid top-left */}
                    <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white backdrop-blur-sm">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {geo.status === "locating" && <span>Locating…</span>}
                      {geo.status === "granted" && geo.coords && <span>±{Math.round(geo.coords.accuracy)}m</span>}
                      {(geo.status === "denied" || geo.status === "unavailable") && <span className="text-amber-300">No GPS — enter manually</span>}
                    </div>

                    {/* AI model status chip, top-right */}
                    <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white backdrop-blur-sm">
                      {detector.modelStatus === "ready" && (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                          AI ready
                        </>
                      )}
                      {detector.modelStatus === "loading" && (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading AI model…
                        </>
                      )}
                      {detector.modelStatus === "unavailable" && (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                          AI unavailable
                        </>
                      )}
                    </div>

                    {!cameraOn && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                        {cameraLoading ? (
                          <Loader2 className="h-6 w-6 animate-spin text-white/70" />
                        ) : (
                          <>
                            <VideoIcon className="h-7 w-7 text-white/50" />
                            {cameraError && <p className="max-w-xs text-xs text-white/70">{cameraError}</p>}
                            <Button size="sm" onClick={startCamera}>
                              <VideoIcon className="h-4 w-4" /> Open camera
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    {cameraOn && (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/70 to-transparent" />
                    )}
                    {cameraOn && captureMode === "video" && (
                      <div className="absolute inset-x-0 bottom-3 flex items-center justify-center">
                        <ShutterButton mode="record" recording={recording} elapsedSeconds={recordSeconds} maxSeconds={MAX_RECORD_SECONDS} onClick={recording ? stopRecording : startRecording} />
                      </div>
                    )}
                    {cameraOn && captureMode === "photo" && (
                      <div className="absolute inset-x-0 bottom-3 flex items-center justify-center">
                        <ShutterButton mode="capture" onClick={capturePhoto} />
                      </div>
                    )}
                  </div>

                  {geo.status === "denied" || geo.status === "unavailable" ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2.5 text-xs">
                      <span className="text-muted-foreground">Manual coordinates:</span>
                      <Input
                        type="number"
                        step="0.0001"
                        placeholder="lat"
                        className="h-7 w-24 text-xs"
                        onChange={(e) => geo.setManual(Number(e.target.value) || CHENNAI_FALLBACK.lat, geo.coords?.lng ?? CHENNAI_FALLBACK.lng)}
                      />
                      <Input
                        type="number"
                        step="0.0001"
                        placeholder="lng"
                        className="h-7 w-24 text-xs"
                        onChange={(e) => geo.setManual(geo.coords?.lat ?? CHENNAI_FALLBACK.lat, Number(e.target.value) || CHENNAI_FALLBACK.lng)}
                      />
                    </div>
                  ) : (
                    geo.status === "granted" &&
                    geo.coords && (
                      <p className="text-center text-[11px] text-muted-foreground">
                        {geo.coords.lat.toFixed(5)}, {geo.coords.lng.toFixed(5)}
                      </p>
                    )
                  )}

                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary">
                    <ImageUp className="h-4 w-4" />
                    Choose from device instead
                    <input type="file" accept={captureMode === "photo" ? "image/*" : "video/*,image/*"} className="hidden" onChange={handleFileUpload} />
                  </label>
                </div>
              )}

              {previewUrl && (
                <div className="flex flex-col gap-3">
                  <div className="overflow-hidden rounded-2xl bg-neutral-950">
                    {blob?.type.startsWith("video") ? (
                      <video src={previewUrl} controls className="aspect-[4/3] w-full object-contain sm:aspect-video" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewUrl} alt="Captured evidence" className="aspect-[4/3] w-full object-cover sm:aspect-video" />
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setBlob(null);
                        if (previewUrl) URL.revokeObjectURL(previewUrl);
                        setPreviewUrl(null);
                      }}
                    >
                      <RotateCcw className="h-4 w-4" /> Retake
                    </Button>
                    <Button onClick={() => processEvidence()} disabled={sessionLoading} className="flex-1">
                      {sessionLoading ? "Checking sign-in…" : "Process evidence"}
                    </Button>
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-destructive">{error}</p>}
            </CardContent>
          </Card>
        )}

        {step === "processing" && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm font-medium">{processingLabel}</p>
              {uploadProgress !== null ? (
                <div className="w-full max-w-xs">
                  <Progress value={Math.round(uploadProgress * 100)} />
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{Math.round(uploadProgress * 100)}%</span>
                    <button type="button" onClick={cancelUpload} className="font-medium text-destructive hover:underline">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="max-w-sm text-center text-xs text-muted-foreground">
                  Real object detection runs on your device — nothing is assumed from the category you picked.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {step === "review" && incident && result && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Incident detected
              </CardTitle>
              <CardDescription>
                {result.isNewIncident ? "A new report was created" : "Combined with an existing report of the same event"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-lg font-semibold text-foreground">{titleCase(incident.incidentType)}</p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ReviewRow label="Location" value={incident.roadSegment?.name ?? incident.location?.address ?? "Location unavailable"} />
                <ReviewRow label="Time" value={incident.observations[0] ? formatDateTime(incident.observations[0].observation.capturedAt) : "—"} />
                <ReviewRow label="Vehicle" value={vehicleLine(incident.observations[0]?.observation.vehicle ?? null)} full />
              </div>

              {(() => {
                const triage: Triage = deriveTriage(incident.ruleVerdict, incident.evidenceConfidenceOverall);
                const dot = triage === "action_ready" ? "bg-success" : triage === "review_required" ? "bg-warning" : "bg-muted-foreground";
                const captured = describeCaptured(incident.incidentType, incident.observations[0]?.observation ?? null);
                const blocked = triage === "insufficient";

                return (
                  <>
                    <div className="flex items-center gap-2 rounded-lg border border-border p-3">
                      <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />
                      <span className="text-sm font-medium text-foreground">Evidence: {TRIAGE_LABEL[triage]}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{evidenceScoreOf(incident.evidenceConfidenceOverall)}/100</span>
                    </div>

                    <p className={cn("text-xs", captured.nothingRelevant ? "font-medium text-warning" : "text-muted-foreground")}>{captured.text}</p>

                    <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                      <Button
                        onClick={handleSubmitToAuthority}
                        disabled={submitBusy || blocked}
                        title={blocked ? "Evidence is insufficient — this can't be submitted to an authority" : undefined}
                        className="flex-1"
                      >
                        {submitBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {blocked ? "Cannot submit — insufficient evidence" : "Submit report"}
                      </Button>
                      <Button variant="outline" onClick={() => router.push(`/incidents/${result.incidentId}`)} className="flex-1">
                        View evidence
                      </Button>
                      <Button variant="ghost" onClick={() => router.push("/")}>
                        Done
                      </Button>
                    </div>
                    {blocked && (
                      <p className="text-xs text-muted-foreground">
                        This report is still saved under &quot;Your submissions&quot; for your own record, but it won&apos;t be forwarded to an
                        authority — there isn&apos;t enough real evidence to act on.
                      </p>
                    )}
                  </>
                );
              })()}
            </CardContent>
          </Card>
        )}
      </PageContainer>
    </>
  );
}

function ReviewRow({ label, value, full = false }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm text-foreground">{value}</p>
    </div>
  );
}
