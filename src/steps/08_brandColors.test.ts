import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";
import { _resetForTests as resetProviderCooldown } from "../providerCooldown.js";

const { firecrawlMock } = vi.hoisted(() => ({ firecrawlMock: vi.fn() }));
vi.mock("../providers/firecrawl.js", () => ({
  firecrawlScrapeRawHtml: (...args: unknown[]) => firecrawlMock(...args),
  FIRECRAWL_PAGE_COST_USD: 0.001,
}));

import step from "./08_brandColors.js";

function makeLead(website: string | null): LeadRow {
  return { id: "lead-1", step_status: {}, company_data: { merged: { website } } };
}

function stubFetch(routes: Record<string, string | null>) {
  return vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    const html = routes[url];
    if (html === undefined || html === null) return { ok: false, status: 404, text: async () => "" } as Response;
    return { ok: true, status: 200, text: async () => html } as Response;
  });
}

describe("step 08 brand_colors", () => {
  beforeEach(() => {
    resetProviderCooldown();
    firecrawlMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips when the company website is null", async () => {
    const result = await step.run(makeLead(null));
    expect(result).toEqual({ skipped: "company website is null" });
  });

  it("extracts brand colors from a large enough plain-fetch homepage without calling Firecrawl", async () => {
    const html =
      `<html><head><style>:root{--primary:#112233;--secondary:#445566;}</style></head><body>` +
      `<p>${"x".repeat(2000)}</p></body></html>`;
    vi.stubGlobal("fetch", stubFetch({ "https://acme.com": html }));

    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ primary: "#112233", secondary: "#445566" });
    expect(result.cost_usd).toBe(0);
    expect(firecrawlMock).not.toHaveBeenCalled();
  });

  it("stores the full scraped HTML under data.raw, auditable without re-scraping", async () => {
    const html =
      `<html><head><style>:root{--primary:#112233;--secondary:#445566;}</style></head><body>` +
      `<p>${"x".repeat(2000)}</p></body></html>`;
    vi.stubGlobal("fetch", stubFetch({ "https://acme.com": html }));

    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as { raw?: { html?: string } };
    expect(data.raw?.html).toBe(html);
  });

  it("falls back to Firecrawl when the plain fetch is thin, and logs the page cost", async () => {
    const thinHtml = `<html><body>hi</body></html>`;
    const richHtml = `<html><head><style>:root{--primary:#ABCDEF;--secondary:#111111;}</style></head></html>`;
    vi.stubGlobal("fetch", stubFetch({ "https://acme.com": thinHtml }));
    firecrawlMock.mockResolvedValue(richHtml);

    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ primary: "#ABCDEF" });
    expect(result.cost_usd).toBe(0.001);
    expect(result.provider).toBe("firecrawl");
  });

  it("stores the Firecrawl-fetched HTML under data.raw when the fallback path is used", async () => {
    const thinHtml = `<html><body>hi</body></html>`;
    const richHtml = `<html><head><style>:root{--primary:#ABCDEF;--secondary:#111111;}</style></head></html>`;
    vi.stubGlobal("fetch", stubFetch({ "https://acme.com": thinHtml }));
    firecrawlMock.mockResolvedValue(richHtml);

    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as { raw?: { html?: string } };
    expect(data.raw?.html).toBe(richHtml);
  });

  it("stores any fetched stylesheet CSS text under data.raw", async () => {
    const html =
      `<html><head><link rel="stylesheet" href="https://acme.com/style.css">` +
      `<style>:root{--primary:#112233;--secondary:#445566;}</style></head><body>` +
      `<p>${"x".repeat(2000)}</p></body></html>`;
    const css = ".header { color: #778899; }";
    vi.stubGlobal("fetch", stubFetch({ "https://acme.com": html, "https://acme.com/style.css": css }));

    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as { raw?: { stylesheets?: string[] } };
    expect(data.raw?.stylesheets).toContain(css);
  });

  it("skips when neither plain fetch nor Firecrawl return anything", async () => {
    vi.stubGlobal("fetch", stubFetch({}));
    firecrawlMock.mockResolvedValue(null);
    const result = await step.run(makeLead("acme.com"));
    expect(result).toEqual({ skipped: "could not fetch homepage HTML for https://acme.com" });
  });
});
