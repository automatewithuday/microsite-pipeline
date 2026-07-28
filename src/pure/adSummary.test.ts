import { describe, expect, it } from "vitest";
import { adSummary } from "./adSummary.js";

describe("adSummary", () => {
  it("orders channels by count, most active first", () => {
    expect(adSummary(52, 12, 8)).toBe(
      "You run a lot of Meta ads with 52 having been tested. Also quite a lot on LinkedIn, with 12 ads having been run."
    );
  });

  it("reports no significant activity when all counts are zero", () => {
    expect(adSummary(0, 0, 0)).toBe("No significant ad activity detected.");
  });

  it("includes all three channels when all clear the threshold", () => {
    expect(adSummary(15, 40, 100)).toBe(
      "You run a lot of Google ads with 100 having been tested. Also quite a lot on LinkedIn, with 40 ads having been run. Also quite a lot on Meta, with 15 ads having been run."
    );
  });

  it("defaults to no significant activity with no arguments", () => {
    expect(adSummary()).toBe("No significant ad activity detected.");
  });
});
