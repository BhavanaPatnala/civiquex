/** Formats public-facing incident IDs like INC-2026-000124. The sequence number is derived from a DB count in the service layer so it stays correct across restarts and concurrent requests. */
export function formatPublicIncidentId(sequence: number, year = new Date().getFullYear()): string {
  return `INC-${year}-${String(sequence).padStart(6, "0")}`;
}

export function formatSubmissionReference(authorityCode: string, sequence: number, year = new Date().getFullYear()): string {
  return `${authorityCode}-${year}-${String(sequence).padStart(5, "0")}`;
}
