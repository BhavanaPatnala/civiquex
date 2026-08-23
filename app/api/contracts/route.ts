import { ok, withApiHandler } from "@/lib/api/respond";
import { listContracts } from "@/lib/services/contractService";

export const GET = withApiHandler(async () => {
  const contracts = await listContracts();
  const now = new Date();

  return ok(
    contracts.map((c) => ({
      id: c.id,
      tenderNo: c.tenderNo,
      contractorName: c.contractorName,
      officerName: c.officerName,
      roadName: c.roadName,
      city: c.city,
      keywords: JSON.parse(c.keywordsJson),
      workStartDate: c.workStartDate,
      workEndDate: c.workEndDate,
      warrantyEndDate: c.warrantyEndDate,
      activeWarranty: now < c.warrantyEndDate,
      hasBoundary: !!c.boundaryGeojson,
      center: c.centerLat != null && c.centerLng != null ? { lat: c.centerLat, lng: c.centerLng } : null,
      radiusMeters: c.radiusMeters,
    }))
  );
});
