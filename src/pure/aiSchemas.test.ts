import { describe, expect, it } from "vitest";
import {
  followupNarrativeSchema,
  icpSegmentsJsonSchema,
  icpSegmentsSchema,
  salesSignalsJsonSchema,
  salesSignalsSchema,
  tamJsonSchema,
  tamSchema,
  wordCount,
} from "./aiSchemas.js";

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

describe("tool-use JSON schemas (Anthropic API path)", () => {
  // The API enforces JSON Schema draft 2020-12, which forbids the draft-07
  // array form of "items" (tuple syntax). zod-to-json-schema emits that form
  // for z.tuple, and the API rejects the whole request with a 400
  // (live-observed 2026-07-28 on sales_signals). Every tool schema must be
  // free of array-form items anywhere in its tree.
  function assertNoTupleItems(node: unknown, path: string): void {
    if (Array.isArray(node)) {
      node.forEach((child, i) => assertNoTupleItems(child, `${path}[${i}]`));
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "items") expect(Array.isArray(value), `${path}.items is draft-07 tuple form`).toBe(false);
      assertNoTupleItems(value, `${path}.${key}`);
    }
  }

  it("salesSignalsJsonSchema is draft 2020-12 compatible (no tuple-form items)", () => {
    assertNoTupleItems(salesSignalsJsonSchema, "salesSignals");
  });

  it("tamJsonSchema and icpSegmentsJsonSchema are draft 2020-12 compatible", () => {
    assertNoTupleItems(tamJsonSchema, "tam");
    assertNoTupleItems(icpSegmentsJsonSchema, "icpSegments");
  });
});

const validNarrative = {
  diagnosis: [
    { title: "No outbound motion", body: "Traffic shows paid reliance.", groundedIn: "traffic: 62% paid search" },
    { title: "Founder-dependent content", body: "Posting is ad hoc.", groundedIn: "research: LinkedIn cadence" },
  ],
  businessReading: ["Agency plus product arm, both under one roof."],
  fit: "Operator layer under the team: outbound engine plus automation.",
  playbook: [
    { title: "Stand up signal-based outbound", body: "Scrape hiring and funding signals weekly." },
    { title: "Founder LinkedIn engine", body: "Two posts a week on a locked format." },
    { title: "Gated asset capture", body: "One PDF lead magnet routed to nurture." },
  ],
  caseStudyPicks: [
    { id: "dailypay", relevance: "Same enterprise outbound motion." },
    { id: "sk-trading", relevance: "Same founder-led community shape." },
  ],
  playPicks: [{ id: "signal-outbound", relevance: "They have zero outbound today." }],
};

describe("followupNarrativeSchema", () => {
  it("accepts a valid narrative", () => {
    expect(() => followupNarrativeSchema.parse(validNarrative)).not.toThrow();
  });

  it("rejects fewer than 2 diagnosis items", () => {
    const bad = { ...validNarrative, diagnosis: [validNarrative.diagnosis[0]] };
    expect(() => followupNarrativeSchema.parse(bad)).toThrow();
  });

  it("rejects more than 3 case study picks", () => {
    const pick = validNarrative.caseStudyPicks[0]!;
    const bad = { ...validNarrative, caseStudyPicks: [pick, pick, pick, pick] };
    expect(() => followupNarrativeSchema.parse(bad)).toThrow();
  });

  it("rejects a diagnosis item without groundedIn", () => {
    const bad = {
      ...validNarrative,
      diagnosis: [
        { title: "t", body: "b" },
        { title: "t2", body: "b2", groundedIn: "g" },
      ],
    };
    expect(() => followupNarrativeSchema.parse(bad)).toThrow();
  });

  it("rejects fewer than 3 playbook steps", () => {
    const bad = { ...validNarrative, playbook: validNarrative.playbook.slice(0, 2) };
    expect(() => followupNarrativeSchema.parse(bad)).toThrow();
  });
});
