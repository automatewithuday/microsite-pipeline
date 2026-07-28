import { describe, expect, it } from "vitest";
import { interpolatePrompt } from "./interpolatePrompt.js";

describe("interpolatePrompt", () => {
  it("replaces every {placeholder} with the matching value", () => {
    const result = interpolatePrompt("Hi {Company}, at {domain}", { Company: "Acme", domain: "acme.com" });
    expect(result).toBe("Hi Acme, at acme.com");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(interpolatePrompt("{Company} and {Unknown}", { Company: "Acme" })).toBe("Acme and {Unknown}");
  });

  it("replaces repeated occurrences of the same placeholder", () => {
    expect(interpolatePrompt("{Company} is {Company}", { Company: "Acme" })).toBe("Acme is Acme");
  });
});
