// Locks the cross-template contract: both deck templates must expose exactly
// the same [Token] and data-slot sets, so src/pure/microsite.ts can build
// either without conditional logic. Also enforces the Signal template's
// structural invariants (no brand accent, clean closing tag, font marker).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const dcn = read("../templates/microsite/index.src.html");
const signal = read("../templates/microsite-signal/index.src.html");

const tokensOf = (html: string): string[] =>
  [...new Set(html.match(/\[[A-Z][A-Za-z0-9 _]*\]/g) ?? [])].sort();
const slotsOf = (html: string): string[] =>
  [...new Set([...html.matchAll(/data-slot="([^"]+)"/g)].map((m) => m[1]!))].sort();

describe("deck template contract", () => {
  it("both templates expose the same token set", () => {
    expect(tokensOf(signal)).toEqual(tokensOf(dcn));
  });

  it("both templates expose the same data-slot set", () => {
    expect(slotsOf(signal)).toEqual(slotsOf(dcn));
  });

  it("both templates carry the font marker", () => {
    expect(dcn).toContain("/*__DECK_FONTS__*/");
    expect(signal).toContain("/*__DECK_FONTS__*/");
  });

  it("signal template never references the brand accent variable", () => {
    expect(signal).not.toContain("--brand-accent");
  });

  it("signal template contains the closing body tag exactly once", () => {
    // Keeps CSS comments clean so the pure layer's lastIndexOf injection
    // anchor always finds the real tag.
    expect(signal.match(/<\/body>/gi)).toHaveLength(1);
  });

  it("both templates have exactly 9 sections", () => {
    expect(dcn.match(/<section /g)).toHaveLength(9);
    expect(signal.match(/<section /g)).toHaveLength(9);
  });
});
