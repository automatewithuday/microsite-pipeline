import { describe, expect, it } from "vitest";
import { libraryDigest, proofLibrarySchema, validatePicks } from "./proofLibrary.js";

const minimalLibrary = {
  profile: {
    positioning: "Fractional CMO. Strategy & architecture.",
    locationLine: "Pune based, same time zone, no coordination tax.",
    calUrl: "https://cal.com/uday-kang/15min",
    repoLinks: ["https://github.com/udaykang-byte/gtm-flywheel"],
  },
  caseStudies: [
    {
      id: "dailypay",
      client: "DailyPay",
      verticalTags: ["fintech", "b2b-saas", "enterprise"],
      motionTags: ["outbound", "abm"],
      problem: "Fill enterprise pipeline with long sales cycles.",
      approach: "Account scoring, sequenced email + LinkedIn + CTV.",
      metrics: [
        { value: "2,700+", label: "Demos booked" },
        { value: "$3.3M+", label: "Pipeline influenced" },
      ],
    },
  ],
  plays: [
    {
      id: "signal-outbound",
      name: "Signal-based outbound",
      whenTags: ["outbound", "b2b"],
      steps: ["Scrape hiring/funding/tech signals", "Trigger outreach in the buying window"],
    },
  ],
  platforms: [
    {
      id: "dsp",
      name: "Programmatic Advertising Platform (DSP/SSP)",
      description: "Owned programmatic infrastructure: display, video & CTV",
      link: "https://www.yadamedia.io/programmatic-advertising",
      metrics: [],
    },
  ],
  plan30day: [{ title: "Audit", deliverables: ["Full review of client base and delivery process"] }],
};

describe("proofLibrarySchema", () => {
  it("accepts a well-formed library", () => {
    expect(() => proofLibrarySchema.parse(minimalLibrary)).not.toThrow();
  });

  it("rejects a case study without metrics array", () => {
    const bad = structuredClone(minimalLibrary) as Record<string, unknown>;
    delete (bad.caseStudies as Record<string, unknown>[])[0]!.metrics;
    expect(() => proofLibrarySchema.parse(bad)).toThrow();
  });

  it("rejects duplicate case study ids", () => {
    const bad = structuredClone(minimalLibrary);
    bad.caseStudies.push(structuredClone(bad.caseStudies[0]!));
    expect(() => proofLibrarySchema.parse(bad)).toThrow(/duplicate/i);
  });

  it("rejects an empty metric value", () => {
    const bad = structuredClone(minimalLibrary);
    bad.caseStudies[0]!.metrics[0]!.value = "";
    expect(() => proofLibrarySchema.parse(bad)).toThrow();
  });
});

describe("libraryDigest", () => {
  it("lists every case study and play id with tags, but no metric values", () => {
    const lib = proofLibrarySchema.parse(minimalLibrary);
    const digest = libraryDigest(lib);
    expect(digest).toContain("dailypay");
    expect(digest).toContain("fintech");
    expect(digest).toContain("signal-outbound");
    // Digest keeps the prompt small: never full metrics.
    expect(digest).not.toContain("2,700+");
  });
});

describe("validatePicks", () => {
  it("returns invalid ids and accepts valid ones", () => {
    expect(validatePicks([{ id: "dailypay" }, { id: "nope" }], ["dailypay"])).toEqual(["nope"]);
    expect(validatePicks([{ id: "dailypay" }], ["dailypay"])).toEqual([]);
  });
});
