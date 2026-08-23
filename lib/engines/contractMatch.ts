// ---------------------------------------------------------------------------
// Contract Registry Matching Engine
//
// Mirrors the approach reported for real-world "AI pothole hunter" tools
// (e.g. the Bengaluru engineer's Potholes Detector, covered by Gizbot):
// a detected road-surface issue's real GPS position is matched against a
// registry of road-work contracts to find who is contractually responsible
// and whether the work is still under warranty — so a complaint can name a
// contractor and officer instead of disappearing into a general queue.
//
// The registry itself is demo data (see prisma/seed.ts — no verified open
// API for government road-contract records was found; fabricating one is
// against this project's rules). The match runs on a real GPS point.
// ---------------------------------------------------------------------------

import { distanceMeters, pointInPolygon, type LatLng } from "@/lib/geo";

export interface ContractRecord {
  id: string;
  tenderNo: string;
  contractorName: string;
  contractorEmail: string;
  officerName: string;
  officerEmail: string;
  roadName: string;
  boundary: [number, number][] | null; // GeoJSON polygon, [lng,lat]
  center: LatLng | null;
  radiusMeters: number | null;
  keywords: string[];
  warrantyEndDate: Date;
}

export interface ContractMatchResult {
  contract: ContractRecord;
  score: number; // 0-100
  matchedBy: string[];
  activeWarranty: boolean;
  recipientEmails: string[];
}

const SCORE = {
  activeWarranty: 30,
  boundaryMatch: 35,
  radiusMatch: 25,
  keywordMatch: 10,
};

function matchesNotes(contract: ContractRecord, notes: string | null | undefined): boolean {
  if (!notes) return false;
  const lower = notes.toLowerCase();
  return contract.keywords.some((k) => lower.includes(k.toLowerCase())) || lower.includes(contract.roadName.toLowerCase());
}

function buildRecipients(contract: ContractRecord): string[] {
  return [contract.officerEmail, contract.contractorEmail];
}

/**
 * Scores every candidate contract against a real detected point and picks
 * the best match. Returns null if nothing has any location signal — this
 * never guesses a contractor without at least a location match.
 */
export function matchContract(input: {
  point: LatLng;
  notes?: string | null;
  now?: Date;
  contracts: ContractRecord[];
}): ContractMatchResult | null {
  const now = input.now ?? new Date();
  let best: ContractMatchResult | null = null;

  for (const contract of input.contracts) {
    let score = 0;
    const matchedBy: string[] = [];

    const activeWarranty = now < contract.warrantyEndDate;
    if (activeWarranty) {
      score += SCORE.activeWarranty;
      matchedBy.push("active warranty");
    }

    let hasLocationMatch = false;
    if (contract.boundary && pointInPolygon(input.point, contract.boundary)) {
      score += SCORE.boundaryMatch;
      matchedBy.push("bounding box");
      hasLocationMatch = true;
    } else if (contract.center && contract.radiusMeters != null && distanceMeters(input.point, contract.center) <= contract.radiusMeters) {
      score += SCORE.radiusMatch;
      matchedBy.push("radius");
      hasLocationMatch = true;
    }

    if (matchesNotes(contract, input.notes)) {
      score += SCORE.keywordMatch;
      matchedBy.push("road keyword");
    }

    if (!hasLocationMatch) continue; // never match a contract on keyword/warranty alone

    if (!best || score > best.score) {
      best = { contract, score, matchedBy, activeWarranty, recipientEmails: buildRecipients(contract) };
    }
  }

  return best;
}
