import { describe, expect, it } from "vitest";
import { normalizeDomain, toHttpUrl } from "./normalize.js";

describe("normalizeDomain", () => {
  it("strips https protocol", () => {
    expect(normalizeDomain("https://example.com")).toBe("example.com");
  });

  it("strips http protocol", () => {
    expect(normalizeDomain("http://example.com")).toBe("example.com");
  });

  it("strips a leading www.", () => {
    expect(normalizeDomain("https://www.example.com")).toBe("example.com");
  });

  it("strips a trailing slash", () => {
    expect(normalizeDomain("https://example.com/")).toBe("example.com");
  });

  it("strips a trailing path", () => {
    expect(normalizeDomain("https://example.com/pricing")).toBe("example.com");
  });

  it("lowercases the result", () => {
    expect(normalizeDomain("HTTPS://WWW.Example.COM/")).toBe("example.com");
  });

  it("handles a bare domain with no protocol or www", () => {
    expect(normalizeDomain("example.com")).toBe("example.com");
  });

  it("strips protocol and www and trailing slash together", () => {
    expect(normalizeDomain("http://www.example.com/")).toBe("example.com");
  });

  it("returns null for null input", () => {
    expect(normalizeDomain(null)).toBe(null);
  });

  it("returns null for undefined input", () => {
    expect(normalizeDomain(undefined)).toBe(null);
  });

  it("returns null for an empty string", () => {
    expect(normalizeDomain("")).toBe(null);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDomain("  example.com  ")).toBe("example.com");
  });
});

// Deepline's real company payload returns website as a bare domain
// ("martechs.io"), which fetch() rejects as an invalid URL. toHttpUrl makes
// any website value fetchable.
describe("toHttpUrl", () => {
  it("prefixes https:// on a bare domain", () => {
    expect(toHttpUrl("martechs.io")).toBe("https://martechs.io");
  });

  it("leaves an https URL unchanged", () => {
    expect(toHttpUrl("https://example.com/pricing")).toBe("https://example.com/pricing");
  });

  it("leaves an http URL unchanged", () => {
    expect(toHttpUrl("http://example.com")).toBe("http://example.com");
  });

  it("trims whitespace", () => {
    expect(toHttpUrl("  example.com ")).toBe("https://example.com");
  });

  it("returns null for null, undefined, or empty input", () => {
    expect(toHttpUrl(null)).toBe(null);
    expect(toHttpUrl(undefined)).toBe(null);
    expect(toHttpUrl("")).toBe(null);
    expect(toHttpUrl("   ")).toBe(null);
  });
});
