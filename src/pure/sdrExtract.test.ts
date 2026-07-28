import { describe, expect, it } from "vitest";
import { extractPeopleCount } from "./sdrExtract.js";

describe("extractPeopleCount", () => {
  it("reads total_persons, the tool's real (live-verified) output field", () => {
    expect(extractPeopleCount({ total_search_results: 5, total_persons: 4, total_organizations: 1 })).toBe(4);
  });

  it("reads peopleCount", () => {
    expect(extractPeopleCount({ peopleCount: 4 })).toBe(4);
  });

  it("falls back to totalCount", () => {
    expect(extractPeopleCount({ totalCount: 7 })).toBe(7);
  });

  it("falls back to total", () => {
    expect(extractPeopleCount({ total: 2 })).toBe(2);
  });

  it("returns null when no candidate field is present", () => {
    expect(extractPeopleCount({})).toBeNull();
  });

  it("returns null for a non-object raw payload", () => {
    expect(extractPeopleCount(null)).toBeNull();
  });
});
