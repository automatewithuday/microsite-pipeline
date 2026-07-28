import { describe, expect, it } from "vitest";
import { extractBrandColors } from "./brandColors.js";

describe("extractBrandColors", () => {
  it("prefers CSS custom properties when present", () => {
    const html = `
      <html><head><style>
        :root { --primary: #1A2B3C; --secondary: #FF00AA; }
      </style></head><body><header class="header">Acme</header></body></html>
    `;
    const result = extractBrandColors({ html });
    expect(result.primary).toBe("#1A2B3C");
    expect(result.secondary).toBe("#FF00AA");
    expect(result.notes).toContain("css custom properties");
  });

  it("falls back through the alias var names in priority order", () => {
    const html = `<style>:root{--brand-primary:#112233;--color-secondary:#445566;}</style>`;
    const result = extractBrandColors({ html });
    expect(result.primary).toBe("#112233");
    expect(result.secondary).toBe("#445566");
  });

  it("returns empty strings with a note when only neutral grays are found", () => {
    const html = `
      <style>
        :root { --primary: #808080; --secondary: #333333; }
        header.hero { background-color: #eeeeee; }
      </style>
      <header class="hero" style="color:#111111;">Acme</header>
    `;
    const result = extractBrandColors({ html });
    expect(result.primary).toBe("");
    expect(result.secondary).toBe("");
    expect(result.notes).toMatch(/only neutral/i);
  });

  it("normalizes rgb() and hsl() color functions to #RRGGBB", () => {
    const html = `
      <style>
        header.header { background-color: rgb(20, 120, 220); }
        .btn-primary { color: hsl(340, 80%, 50%); }
      </style>
      <header class="header">Acme</header>
      <button class="btn-primary">Buy</button>
    `;
    const result = extractBrandColors({ html });
    expect(result.primary).toMatch(/^#[0-9A-F]{6}$/);
    expect(result.secondary).toMatch(/^#[0-9A-F]{6}$/);
    // rgb(20,120,220) -> #1478DC
    expect(result.primary).toBe("#1478DC");
  });

  it("excludes near-white colors as neutral even when prominent", () => {
    const html = `
      <style>
        header.header { background-color: #fafafa; }
        nav.nav { background-color: #2255AA; }
      </style>
      <header class="header">Acme</header>
      <nav class="nav">Menu</nav>
    `;
    const result = extractBrandColors({ html });
    expect(result.primary).toBe("#2255AA");
  });

  it("stores raw_source-relevant notes and ranks by frequency when no CSS vars exist", () => {
    const html = `
      <style>
        header.header { background-color: #AA2233; }
        .cta { background-color: #AA2233; }
        .btn-primary { color: #223344; }
      </style>
      <header class="header">Acme</header>
      <button class="cta">Go</button>
      <button class="btn-primary">Buy</button>
    `;
    const result = extractBrandColors({ html });
    expect(result.primary).toBe("#AA2233");
    expect(result.secondary).toBe("#223344");
  });

  it("falls back to a broad frequency scan when selectors are hashed (Framer/Webflow)", () => {
    // Page-builder markup: no header/nav/hero/button selectors at all, just
    // hashed class names, so the semantic pass finds nothing. The accent
    // (#FF4D00) is the most-repeated non-neutral color and must surface.
    const html = `
      <style>
        .framer-a1b2c3 { background-color: #FF4D00; }
        .framer-d4e5f6 { color: #FF4D00; }
        .framer-99z8y7 { background: #F5EFE6; }
        .framer-11a2b3 { color: #111111; }
        .framer-cta77 { background-color: #FF4D00; }
      </style>
      <div class="framer-a1b2c3">x</div>
    `;
    const result = extractBrandColors({ html });
    expect(result.primary).toBe("#FF4D00");
    expect(result.notes).toMatch(/page-builder fallback/i);
  });

  it("does not use the broad fallback when a semantic selector already matched", () => {
    const html = `
      <style>
        header.header { background-color: #2255AA; }
        .framer-x { background-color: #FF4D00; }
      </style>
      <header class="header">Acme</header>
    `;
    // Semantic pass finds #2255AA; the hashed #FF4D00 must NOT override it.
    const result = extractBrandColors({ html });
    expect(result.primary).toBe("#2255AA");
    expect(result.notes).not.toMatch(/page-builder fallback/i);
  });

  it("includes linked stylesheet content when provided", () => {
    const html = `<header class="header">Acme</header>`;
    const stylesheets = [":root { --primary: #654321; --secondary: #123456; }"];
    const result = extractBrandColors({ html, stylesheets });
    expect(result.primary).toBe("#654321");
    expect(result.secondary).toBe("#123456");
  });
});
