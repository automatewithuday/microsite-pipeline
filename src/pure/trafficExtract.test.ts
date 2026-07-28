import { describe, expect, it } from "vitest";
import { extractTraffic } from "./trafficExtract.js";

describe("extractTraffic", () => {
  it("returns null (caller should skip) when the actor returns no items", () => {
    expect(extractTraffic([])).toBeNull();
  });

  it("returns null when the single item has no totalVisits (small/new domain)", () => {
    expect(extractTraffic([{ domain: "tiny.com" }])).toBeNull();
  });

  it("computes paidSearchVisits from a paidSearchShare fraction field", () => {
    const result = extractTraffic([{ totalVisits: 100000, paidSearchShare: 0.12 }]);
    expect(result).toEqual({
      totalVisits: 100000,
      paidSearchVisits: 12000,
      source_field: "paidSearchShare",
    });
  });

  it("falls back to a generic paid-referral share field and notes the field used", () => {
    const result = extractTraffic([{ totalVisits: 50000, displayAdsTraffic: 0.04 }]);
    expect(result).toEqual({
      totalVisits: 50000,
      paidSearchVisits: 2000,
      source_field: "displayAdsTraffic",
    });
  });

  it("leaves paidSearchVisits null when no paid-share field is present at all", () => {
    const result = extractTraffic([{ totalVisits: 30000, directTraffic: 0.5 }]);
    expect(result).toEqual({ totalVisits: 30000, paidSearchVisits: null, source_field: null });
  });

  it("rounds totalVisits and paidSearchVisits to integers", () => {
    const result = extractTraffic([{ totalVisits: 12345.6, paidSearchShare: 0.333 }]);
    expect(result?.totalVisits).toBe(12346);
    expect(result?.paidSearchVisits).toBe(Math.round(12345.6 * 0.333));
  });
});
