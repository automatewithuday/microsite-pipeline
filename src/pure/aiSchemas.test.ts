import { describe, expect, it } from "vitest";
import { icpSegmentsSchema, salesSignalsSchema, tamSchema, wordCount } from "./aiSchemas.js";

const segment = {
  segmentName: "Mid-market SaaS ops teams",
  companyCharacteristic: "50-200 employees, PLG motion",
  keyPainPoint: "No dedicated outbound function",
  primaryBuyer: "VP Sales",
  differentiatingNeed: "Wants ABM without headcount",
};

describe("tamSchema", () => {
  it("accepts a positive integer", () => {
    expect(tamSchema.parse({ tamEstimation: 4200 })).toEqual({ tamEstimation: 4200 });
  });

  it("accepts optional scenario counts when present", () => {
    expect(
      tamSchema.parse({ tamEstimation: 33200, tamRealistic: 17000, tamConservative: 8294 })
    ).toEqual({ tamEstimation: 33200, tamRealistic: 17000, tamConservative: 8294 });
  });

  it("rejects a non-positive or non-integer scenario count", () => {
    expect(tamSchema.safeParse({ tamEstimation: 33200, tamRealistic: 0 }).success).toBe(false);
    expect(tamSchema.safeParse({ tamEstimation: 33200, tamConservative: 8.5 }).success).toBe(false);
  });

  it("rejects 0", () => {
    expect(tamSchema.safeParse({ tamEstimation: 0 }).success).toBe(false);
  });

  it("rejects a negative number", () => {
    expect(tamSchema.safeParse({ tamEstimation: -5 }).success).toBe(false);
  });

  it("rejects a non-integer", () => {
    expect(tamSchema.safeParse({ tamEstimation: 4200.5 }).success).toBe(false);
  });

  it("rejects a missing field", () => {
    expect(tamSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a string number", () => {
    expect(tamSchema.safeParse({ tamEstimation: "4200" }).success).toBe(false);
  });
});

describe("icpSegmentsSchema", () => {
  it("accepts exactly 2 segments", () => {
    const result = icpSegmentsSchema.safeParse({ segments: [segment, segment] });
    expect(result.success).toBe(true);
  });

  it("accepts 4 segments", () => {
    const result = icpSegmentsSchema.safeParse({ segments: [segment, segment, segment, segment] });
    expect(result.success).toBe(true);
  });

  it("rejects fewer than 2 segments", () => {
    const result = icpSegmentsSchema.safeParse({ segments: [segment] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 4 segments", () => {
    const result = icpSegmentsSchema.safeParse({
      segments: [segment, segment, segment, segment, segment],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a segment missing a required field", () => {
    const { primaryBuyer, ...rest } = segment;
    const result = icpSegmentsSchema.safeParse({ segments: [rest, segment] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty-string field", () => {
    const result = icpSegmentsSchema.safeParse({
      segments: [{ ...segment, segmentName: "" }, segment],
    });
    expect(result.success).toBe(false);
  });
});

describe("wordCount", () => {
  it("counts space-separated words", () => {
    expect(wordCount("paid heavy but no outbound motion")).toBe(6);
  });

  it("is 0 for an empty string", () => {
    expect(wordCount("")).toBe(0);
  });

  it("collapses repeated whitespace", () => {
    expect(wordCount("one   two\tthree")).toBe(3);
  });
});

describe("salesSignalsSchema", () => {
  const shortSignal = "You run 40 Meta ads monthly but have no outbound motion in place today.";

  it("accepts exactly 3 signals under the 25-word cap", () => {
    const result = salesSignalsSchema.safeParse({ signals: [shortSignal, shortSignal, shortSignal] });
    expect(result.success).toBe(true);
  });

  it("rejects fewer than 3 signals", () => {
    const result = salesSignalsSchema.safeParse({ signals: [shortSignal, shortSignal] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 3 signals", () => {
    const result = salesSignalsSchema.safeParse({
      signals: [shortSignal, shortSignal, shortSignal, shortSignal],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a signal over 25 words", () => {
    const longSignal = Array.from({ length: 26 }, (_, i) => `word${i}`).join(" ");
    const result = salesSignalsSchema.safeParse({ signals: [shortSignal, shortSignal, longSignal] });
    expect(result.success).toBe(false);
  });

  it("accepts a signal at exactly 25 words", () => {
    const exact25 = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ");
    const result = salesSignalsSchema.safeParse({ signals: [shortSignal, shortSignal, exact25] });
    expect(result.success).toBe(true);
  });

  it("rejects an empty-string signal", () => {
    const result = salesSignalsSchema.safeParse({ signals: [shortSignal, shortSignal, ""] });
    expect(result.success).toBe(false);
  });
});
