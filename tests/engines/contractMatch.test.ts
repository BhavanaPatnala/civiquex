import { describe, expect, it } from "vitest";
import { matchContract, type ContractRecord } from "@/lib/engines/contractMatch";

const rect = (minLng: number, minLat: number, maxLng: number, maxLat: number): [number, number][] => [
  [minLng, minLat],
  [maxLng, minLat],
  [maxLng, maxLat],
  [minLng, maxLat],
  [minLng, minLat],
];

const activeContract: ContractRecord = {
  id: "c1",
  tenderNo: "TN-001",
  contractorName: "ABC Roadworks",
  contractorEmail: "abc@example-contractor.demo",
  officerName: "R. Kumar",
  officerEmail: "rkumar@example-gcc.demo",
  roadName: "Anna Salai",
  boundary: rect(80.24, 13.05, 80.26, 13.07),
  center: null,
  radiusMeters: null,
  keywords: ["anna salai", "mount road"],
  warrantyEndDate: new Date("2027-01-01"),
};

const expiredContract: ContractRecord = {
  ...activeContract,
  id: "c2",
  tenderNo: "TN-002",
  warrantyEndDate: new Date("2020-01-01"),
};

describe("Contract Registry Matching Engine", () => {
  it("matches a real GPS point inside a contract's boundary and flags active warranty", () => {
    const result = matchContract({ point: { lat: 13.06, lng: 80.25 }, contracts: [activeContract] });
    expect(result).not.toBeNull();
    expect(result!.contract.id).toBe("c1");
    expect(result!.activeWarranty).toBe(true);
    expect(result!.matchedBy).toContain("bounding box");
    expect(result!.recipientEmails).toEqual([activeContract.officerEmail, activeContract.contractorEmail]);
  });

  it("never matches on keyword or warranty alone — a location signal is required", () => {
    const result = matchContract({ point: { lat: 0, lng: 0 }, notes: "pothole near Anna Salai", contracts: [activeContract] });
    expect(result).toBeNull();
  });

  it("falls back to radius matching when no boundary polygon is set", () => {
    const radiusContract: ContractRecord = { ...activeContract, id: "c3", boundary: null, center: { lat: 13.03, lng: 80.24 }, radiusMeters: 200 };
    const closeBy = matchContract({ point: { lat: 13.0305, lng: 80.2405 }, contracts: [radiusContract] });
    expect(closeBy?.matchedBy).toContain("radius");

    const farAway = matchContract({ point: { lat: 13.1, lng: 80.3 }, contracts: [radiusContract] });
    expect(farAway).toBeNull();
  });

  it("correctly reports an expired warranty as not active while still matching on location", () => {
    const result = matchContract({ point: { lat: 13.06, lng: 80.25 }, contracts: [expiredContract] });
    expect(result?.activeWarranty).toBe(false);
    expect(result?.matchedBy).not.toContain("active warranty");
  });

  it("picks the highest-scoring contract when multiple overlap the same point", () => {
    // Same boundary and warranty as activeContract, but a different road name/keyword
    // set that does NOT appear in the note — so it loses the keyword-match points
    // activeContract earns, and activeContract must win.
    const overlapping: ContractRecord = { ...activeContract, id: "c4", tenderNo: "TN-004", roadName: "Kamarajar Salai", keywords: ["kamarajar"] };
    const result = matchContract({ point: { lat: 13.06, lng: 80.25 }, notes: "pothole on Anna Salai road", contracts: [overlapping, activeContract] });
    expect(result?.contract.id).toBe("c1"); // activeContract's keywords/road name match "anna salai" in the note, scoring higher
  });
});
