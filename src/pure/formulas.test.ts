import { describe, expect, it } from "vitest";
import {
  adjustedTam,
  adjustedTam2,
  liFollowersInsight,
  paidSearchPct,
  qualified,
  sdrInsight,
} from "./formulas.js";

describe("qualified", () => {
  it("is true for a mid-size software company", () => {
    expect(qualified(50, "Software Development")).toBe(true);
  });

  it("is true at the lower employee boundary", () => {
    expect(qualified(11, "software")).toBe(true);
  });

  it("is true at the upper employee boundary", () => {
    expect(qualified(200, "Enterprise Software")).toBe(true);
  });

  it("is false just below the lower employee boundary", () => {
    expect(qualified(10, "software")).toBe(false);
  });

  it("is false just above the upper employee boundary", () => {
    expect(qualified(201, "software")).toBe(false);
  });

  it("is false for a non-software industry", () => {
    expect(qualified(50, "Fintech")).toBe(false);
  });

  it("is false when industry is null", () => {
    expect(qualified(50, null as any)).toBe(false);
  });
});

describe("paidSearchPct", () => {
  it("formats visits (exact, matching the signals page) and paid percentage", () => {
    expect(paidSearchPct(12345, 3086)).toBe(
      "Around 12,345 monthly visits, 25% coming from paid"
    );
  });

  it("returns null when total is zero", () => {
    expect(paidSearchPct(0, 0)).toBe(null);
  });
});

describe("liFollowersInsight", () => {
  it("uses the exact count above the threshold (matches the signals page)", () => {
    expect(liFollowersInsight("Acme", 12345)).toBe(
      "Acme has 12,345 LinkedIn followers, so LinkedIn social is probably a significant channel."
    );
  });

  it("uses the exact-count phrasing at or below the threshold", () => {
    expect(liFollowersInsight("Acme", 9500)).toBe(
      "Acme has 9,500 LinkedIn followers so LinkedIn social could probably become a bigger channel."
    );
  });

  it("title-cases a lowercased first name (\"maximus\" -> \"Maximus\")", () => {
    expect(liFollowersInsight("maximus", 40000)).toBe(
      "Maximus has 40,000 LinkedIn followers, so LinkedIn social is probably a significant channel."
    );
  });
});

describe("sdrInsight", () => {
  it("describes a team of 3 or more as significant", () => {
    expect(sdrInsight(3)).toBe(
      "With a SDR team of 3, outbound must be a relatively significant channel."
    );
  });

  it("describes a team of 1 or 2 as room to grow", () => {
    expect(sdrInsight(1)).toBe(
      "With a SDR team of 1, the outbound motion could have some room to grow."
    );
  });

  it("describes zero SDRs as room for development", () => {
    expect(sdrInsight(0)).toBe(
      "With no SDRs/BDRs, the outbound motion has a lot of room for development."
    );
  });
});

describe("adjustedTam / adjustedTam2", () => {
  it("adjustedTam rounds 90% of TAM to the nearest 1000", () => {
    expect(adjustedTam(10000)).toBe(9000);
  });

  it("adjustedTam rounds 90% of a non-round TAM to the nearest 1000", () => {
    expect(adjustedTam(12500)).toBe(11000);
  });

  it("adjustedTam2 rounds 60% of TAM to the nearest 1000", () => {
    expect(adjustedTam2(10000)).toBe(6000);
  });
});
