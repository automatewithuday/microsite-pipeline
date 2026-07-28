import { describe, expect, it } from "vitest";
import { loadProofLibrary } from "./proofLibrary.js";

describe("loadProofLibrary", () => {
  it("loads and validates the committed seed library", () => {
    const lib = loadProofLibrary();
    expect(lib.caseStudies.length).toBeGreaterThanOrEqual(5);
    expect(lib.plays.length).toBe(5);
    expect(lib.profile.calUrl).toContain("cal.com");
    // Verbatim metric survives the round trip untouched.
    const dailypay = lib.caseStudies.find((c) => c.id === "dailypay");
    expect(dailypay?.metrics[0]).toEqual({ value: "2,700+", label: "Demos booked" });
  });
});
