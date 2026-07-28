import { describe, expect, it } from "vitest";
import { extractFirstFounder, extractLinkedinFollowers } from "./foundersExtract.js";

describe("extractFirstFounder", () => {
  it("reads founders[0] from a top-level founders array, first_name + linkedin", () => {
    const raw = {
      founders: [
        { first_name: "Jane", URLs: { linkedin: "https://linkedin.com/in/jane" } },
        { first_name: "Bob", URLs: { linkedin: "https://linkedin.com/in/bob" } },
      ],
    };
    expect(extractFirstFounder(raw)).toEqual({
      first_name: "Jane",
      linkedin_url: "https://linkedin.com/in/jane",
    });
  });

  it("falls back to snake_case linkedin_url field", () => {
    const raw = { founders: [{ first_name: "Jane", linkedin_url: "https://linkedin.com/in/jane" }] };
    expect(extractFirstFounder(raw)).toEqual({
      first_name: "Jane",
      linkedin_url: "https://linkedin.com/in/jane",
    });
  });

  it("returns null on an empty founders array", () => {
    expect(extractFirstFounder({ founders: [] })).toBeNull();
  });

  it("returns null when there is no founders field at all", () => {
    expect(extractFirstFounder({})).toBeNull();
  });

  it("keeps first_name null when the founder has no linkedin URL, rather than dropping the founder", () => {
    const raw = { founders: [{ first_name: "Jane" }] };
    expect(extractFirstFounder(raw)).toEqual({ first_name: "Jane", linkedin_url: null });
  });
});

describe("extractLinkedinFollowers", () => {
  it("reads linkedinFollowers", () => {
    expect(extractLinkedinFollowers({ linkedinFollowers: 4200 })).toBe(4200);
  });

  it("falls back to snake_case and other candidate field names", () => {
    expect(extractLinkedinFollowers({ num_followers: 900 })).toBe(900);
  });

  it("returns null when no candidate field is present", () => {
    expect(extractLinkedinFollowers({})).toBeNull();
  });
});
