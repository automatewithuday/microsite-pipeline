import { describe, it, expect } from "vitest";
import type { LeadRow } from "../db.js";
import {
  DECK_TEMPLATES,
  DEFAULT_DECK_TEMPLATE,
  assertDeckTemplateName,
  resolveDeckTemplate,
} from "./deckTemplates.js";

function lead(overrides: Record<string, unknown> = {}): LeadRow {
  return { id: "x", step_status: {}, ...overrides };
}

describe("DECK_TEMPLATES", () => {
  it("contains both variants", () => {
    expect(Object.keys(DECK_TEMPLATES).sort()).toEqual(["microsite", "microsite-signal"]);
  });

  it("keeps the DCN font list unchanged (10 faces)", () => {
    expect(DECK_TEMPLATES["microsite"]!.fonts).toHaveLength(10);
    expect(DECK_TEMPLATES["microsite"]!.fonts[0]).toEqual({
      file: "fraunces-300.woff2", family: "Fraunces", weight: 300, style: "normal",
    });
  });

  it("lists the 5 Signal faces", () => {
    expect(DECK_TEMPLATES["microsite-signal"]!.fonts.map((f) => f.file)).toEqual([
      "archivo-400.woff2", "archivo-500.woff2", "archivo-700.woff2",
      "archivo-expanded-700.woff2", "geistmono-400.woff2",
    ]);
  });
});

describe("assertDeckTemplateName", () => {
  it("accepts known names", () => {
    expect(() => assertDeckTemplateName("microsite")).not.toThrow();
    expect(() => assertDeckTemplateName("microsite-signal")).not.toThrow();
  });
  it("throws on unknown names, listing valid ones", () => {
    expect(() => assertDeckTemplateName("signal")).toThrow(
      'unknown deck template "signal" (valid: microsite, microsite-signal)'
    );
  });
  it("rejects prototype property names", () => {
    expect(() => assertDeckTemplateName("toString")).toThrow(
      'unknown deck template "toString" (valid: microsite, microsite-signal)'
    );
    expect(() => assertDeckTemplateName("constructor")).toThrow(
      'unknown deck template "constructor" (valid: microsite, microsite-signal)'
    );
    expect(() => assertDeckTemplateName("hasOwnProperty")).toThrow(
      'unknown deck template "hasOwnProperty" (valid: microsite, microsite-signal)'
    );
  });
});

describe("resolveDeckTemplate", () => {
  it("defaults to microsite", () => {
    expect(resolveDeckTemplate(lead(), undefined)).toBe("microsite");
  });
  it("uses the env value when the lead has no template", () => {
    expect(resolveDeckTemplate(lead(), "microsite-signal")).toBe("microsite-signal");
  });
  it("lead template wins over env", () => {
    expect(resolveDeckTemplate(lead({ template: "microsite" }), "microsite-signal")).toBe("microsite");
  });
  it("treats empty strings as unset", () => {
    expect(resolveDeckTemplate(lead({ template: "" }), "")).toBe("microsite");
  });
  it("ignores non-string lead.template", () => {
    expect(resolveDeckTemplate(lead({ template: 42 }), undefined)).toBe("microsite");
  });
  it("throws on an unknown lead value", () => {
    expect(() => resolveDeckTemplate(lead({ template: "typo" }), undefined)).toThrow(
      'unknown deck template "typo"'
    );
  });
  it("throws on an unknown env value", () => {
    expect(() => resolveDeckTemplate(lead(), "typo")).toThrow('unknown deck template "typo"');
  });
  it("throws on prototype property names in lead", () => {
    expect(() => resolveDeckTemplate(lead({ template: "toString" }), undefined)).toThrow(
      'unknown deck template "toString"'
    );
  });
});
