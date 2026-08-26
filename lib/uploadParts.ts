// Pure part-range math for the resumable multipart upload flow (see
// lib/client/uploadMedia.ts and app/api/media/upload-sessions/**) — no
// environment assumptions, shared by both the browser client and the
// server route so "how many parts" and "which ones are left" can never
// drift between the two sides.

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export function totalPartsFor(totalBytes: number, partSizeBytes: number): number {
  return Math.max(1, Math.ceil(totalBytes / partSizeBytes));
}

/** Replaces any existing record of the same part number (a retried report of the same part) and keeps the list ordered. */
export function mergePart(parts: CompletedPart[], next: CompletedPart): CompletedPart[] {
  return [...parts.filter((p) => p.partNumber !== next.partNumber), next].sort((a, b) => a.partNumber - b.partNumber);
}

/** 1-based part numbers not yet present in `completed`, in upload order. */
export function remainingPartNumbers(totalParts: number, completed: CompletedPart[]): number[] {
  const done = new Set(completed.map((p) => p.partNumber));
  const remaining: number[] = [];
  for (let n = 1; n <= totalParts; n++) {
    if (!done.has(n)) remaining.push(n);
  }
  return remaining;
}

/** The byte range [start, end) for a given 1-based part number. */
export function partByteRange(partNumber: number, partSizeBytes: number, totalBytes: number): { start: number; end: number } {
  const start = (partNumber - 1) * partSizeBytes;
  const end = Math.min(start + partSizeBytes, totalBytes);
  return { start, end };
}
