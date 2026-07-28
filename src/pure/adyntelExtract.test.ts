import { describe, expect, it } from "vitest";
import { extractAdyntelAdCount, extractDataforseoTraffic } from "./adyntelExtract.js";

// Fixtures mirror live probe responses against coldiq.com (2026-07-28).

describe("extractAdyntelAdCount", () => {
  it("reads total_ad_count from an adyntel_google raw payload", () => {
    expect(extractAdyntelAdCount({ ads: [], continuation_token: null, total_ad_count: 44 })).toBe(44);
  });

  it("reads total_ads from an adyntel_linkedin raw payload", () => {
    expect(
      extractAdyntelAdCount({ page_id: "coldlabs", total_ads: 251, ads: [{ id: 1 }], is_last_page: false })
    ).toBe(251);
  });

  it("falls back to the ads array length when no total field is present", () => {
    expect(extractAdyntelAdCount({ ads: [{ id: 1 }, { id: 2 }, { id: 3 }] })).toBe(3);
  });

  it("treats an empty-string raw (adyntel_facebook with no ads) as count 0", () => {
    expect(extractAdyntelAdCount("")).toBe(0);
  });

  it("parses a JSON-string raw before extracting", () => {
    expect(extractAdyntelAdCount('{"total_ad_count": 7}')).toBe(7);
  });

  it("returns null for an unrecognizable payload", () => {
    expect(extractAdyntelAdCount({ something: "else" })).toBeNull();
    expect(extractAdyntelAdCount(null)).toBeNull();
    expect(extractAdyntelAdCount("not json")).toBeNull();
  });
});

describe("extractDataforseoTraffic", () => {
  const liveShapedRaw = {
    version: "0.1.20260101",
    status_code: 20000,
    tasks: [
      {
        status_code: 20000,
        result: [
          {
            target: "coldiq.com",
            items: [
              {
                metrics: {
                  organic: { etv: 36860.28, count: 8309 },
                  paid: { etv: 120.5, count: 3 },
                },
              },
            ],
          },
        ],
      },
    ],
  };

  it("sums organic and paid etv into totalVisits and keeps paid etv as paidSearchVisits", () => {
    expect(extractDataforseoTraffic(liveShapedRaw)).toEqual({
      totalVisits: 36981,
      paidSearchVisits: 121,
      source_field: "dataforseo_etv",
    });
  });

  it("handles a zero-paid domain", () => {
    const raw = structuredClone(liveShapedRaw);
    raw.tasks[0]!.result[0]!.items[0]!.metrics.paid = { etv: 0, count: 0 };
    expect(extractDataforseoTraffic(raw)).toEqual({
      totalVisits: 36860,
      paidSearchVisits: 0,
      source_field: "dataforseo_etv",
    });
  });

  it("returns null when the tasks/result/items path is missing or empty", () => {
    expect(extractDataforseoTraffic({ tasks: [] })).toBeNull();
    expect(extractDataforseoTraffic({ tasks: [{ result: null }] })).toBeNull();
    expect(extractDataforseoTraffic({ tasks: [{ result: [{ items: [] }] }] })).toBeNull();
    expect(extractDataforseoTraffic(null)).toBeNull();
  });

  it("returns null when organic etv is not a finite number", () => {
    const raw = structuredClone(liveShapedRaw);
    (raw.tasks[0]!.result[0]!.items[0]!.metrics.organic as { etv: unknown }).etv = "n/a";
    expect(extractDataforseoTraffic(raw)).toBeNull();
  });
});
