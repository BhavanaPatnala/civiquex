import { describe, expect, it } from "vitest";
import { computeHotspot, RECURRENCE_THRESHOLD } from "@/lib/engines/hotspot";

function sample(daysAgo: number, resolvedDaysAgo: number | null, riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "MEDIUM") {
  const createdAt = new Date(Date.now() - daysAgo * 86400000);
  return {
    incidentId: `inc-${daysAgo}`,
    createdAt,
    resolvedAt: resolvedDaysAgo != null ? new Date(createdAt.getTime() + resolvedDaysAgo * 86400000) : null,
    riskLevel,
  };
}

describe("Recurring Incident Engine", () => {
  it("does NOT treat isolated repeat visits below the threshold as a hotspot", () => {
    const result = computeHotspot([sample(10, 1), sample(5, 1)]);
    expect(result.isRecurring).toBe(false);
  });

  it("flags a hotspot once the same-type incident count at a location crosses the recurrence threshold", () => {
    const samples = Array.from({ length: RECURRENCE_THRESHOLD }, (_, i) => sample(i * 3, 1));
    const result = computeHotspot(samples);
    expect(result.isRecurring).toBe(true);
    expect(result.incidentCount).toBe(RECURRENCE_THRESHOLD);
  });

  it("escalates hotspot risk level as recurrence count grows, never below the individual incidents' own risk", () => {
    const heavy = computeHotspot(Array.from({ length: 12 }, () => sample(1, 1, "MEDIUM")));
    expect(heavy.riskLevel).toBe("CRITICAL");

    const inheritsHighest = computeHotspot([sample(1, 1, "MEDIUM"), sample(2, 1, "CRITICAL"), sample(3, 1, "MEDIUM")]);
    expect(inheritsHighest.riskLevel).toBe("CRITICAL");
  });

  it("computes average resolution duration only from actually-resolved incidents", () => {
    const result = computeHotspot([sample(10, 2), sample(8, 4), sample(6, null)]);
    expect(result.avgDurationMinutes).toBeCloseTo(3 * 24 * 60, 0);
  });
});
