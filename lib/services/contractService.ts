import { prisma } from "@/lib/db";
import { matchContract, type ContractRecord, type ContractMatchResult } from "@/lib/engines/contractMatch";
import type { LatLng } from "@/lib/geo";
import type { Contract } from "@prisma/client";

function toContractRecord(c: Contract): ContractRecord {
  return {
    id: c.id,
    tenderNo: c.tenderNo,
    contractorName: c.contractorName,
    contractorEmail: c.contractorEmail,
    officerName: c.officerName,
    officerEmail: c.officerEmail,
    roadName: c.roadName,
    boundary: c.boundaryGeojson ? JSON.parse(c.boundaryGeojson) : null,
    center: c.centerLat != null && c.centerLng != null ? { lat: c.centerLat, lng: c.centerLng } : null,
    radiusMeters: c.radiusMeters,
    keywords: JSON.parse(c.keywordsJson),
    warrantyEndDate: c.warrantyEndDate,
  };
}

export async function findContractMatch(point: LatLng, notes?: string | null): Promise<ContractMatchResult | null> {
  const contracts = await prisma.contract.findMany();
  return matchContract({ point, notes, contracts: contracts.map(toContractRecord) });
}

export async function listContracts() {
  return prisma.contract.findMany({ orderBy: { roadName: "asc" } });
}
