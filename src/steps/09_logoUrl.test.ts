import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";
import { _resetForTests as resetProviderCooldown } from "../providerCooldown.js";

const { fetchBrandfetchLogosMock, firecrawlMock } = vi.hoisted(() => ({
  fetchBrandfetchLogosMock: vi.fn(),
  firecrawlMock: vi.fn(),
}));

vi.mock("../providers/brandfetch.js", () => ({
  fetchBrandfetchLogos: (...args: unknown[]) => fetchBrandfetchLogosMock(...args),
}));
vi.mock("../providers/firecrawl.js", () => ({
  firecrawlScrapeRawHtml: (...args: unknown[]) => firecrawlMock(...args),
  FIRECRAWL_PAGE_COST_USD: 0.001,
}));
vi.mock("../db.js", () => ({ BRANDFETCH_API_KEY: undefined }));

import step from "./09_logoUrl.js";

function makeLead(domain: string | null, website: string | null = domain): LeadRow {
  return { id: "lead-1", step_status: {}, company_data: { merged: { domain, website } } };
}

function stubFetch(routes: Record<string, string | null>) {
  return vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    const html = routes[url];
    if (html === undefined || html === null) return { ok: false, status: 404, text: async () => "" } as Response;
    return { ok: true, status: 200, text: async () => html } as Response;
  });
}

describe("step 09 logo (BRANDFETCH_API_KEY unset -> fallback path)", () => {
  beforeEach(() => {
    resetProviderCooldown();
    fetchBrandfetchLogosMock.mockReset();
    firecrawlMock.mockReset();
    firecrawlMock.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips when there is no domain or website", async () => {
    const result = await step.run(makeLead(null, null));
    expect(result).toEqual({ skipped: "no company domain or website for logo lookup" });
  });

  it("does not call Brandfetch when BRANDFETCH_API_KEY is unset", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "https://acme.com": `<html><head><meta property="og:image" content="https://acme.com/og.png"></head></html>`,
      })
    );
    await step.run(makeLead("acme.com"));
    expect(fetchBrandfetchLogosMock).not.toHaveBeenCalled();
  });

  it("uses og:image when the page has no header logo", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "https://acme.com": `<html><head><meta property="og:image" content="https://acme.com/og.png"></head></html>`,
      })
    );
    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ url: "https://acme.com/og.png", source_page: "og:image", format: "png" });
  });

  it("prefers the header logo img over og:image when both exist (og:image is usually a share banner, not a logo)", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "https://acme.com": `<html><head><meta property="og:image" content="https://acme.com/og-banner.png"></head><body><header><img src="https://acme.com/logo.svg" alt="Acme"></header></body></html>`,
      })
    );
    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ url: "https://acme.com/logo.svg", source_page: "header_img" });
    // Both candidates stay recorded for auditability.
    const raw = (result.data as { raw: { candidates: unknown[] } }).raw;
    expect(raw.candidates).toEqual(
      expect.arrayContaining([
        { source: "og:image", url: "https://acme.com/og-banner.png" },
        { source: "header_img", url: "https://acme.com/logo.svg" },
      ])
    );
  });

  it("stores the raw fetched HTML and the candidate list on the fallback path (auditable without re-scraping)", async () => {
    const html = `<html><head><meta property="og:image" content="https://acme.com/og.png"></head></html>`;
    vi.stubGlobal("fetch", stubFetch({ "https://acme.com": html }));
    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as { raw?: { html?: string; candidates?: unknown[] } };
    expect(data.raw?.html).toBe(html);
    expect(data.raw?.candidates).toEqual(
      expect.arrayContaining([{ source: "og:image", url: "https://acme.com/og.png" }])
    );
  });

  it("stores the Firecrawl-fetched HTML under data.raw when Firecrawl fires on the fallback path", async () => {
    const richHtml = `<html><head><meta property="og:image" content="https://acme.com/og.png"></head></html>`;
    firecrawlMock.mockReset();
    firecrawlMock.mockResolvedValue(richHtml);
    vi.stubGlobal("fetch", stubFetch({})); // thin/failed plain fetch forces Firecrawl
    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as { raw?: { html?: string } };
    expect(data.raw?.html).toBe(richHtml);
  });

  it("falls back to a header logo img when there is no og:image", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "https://acme.com": `<html><body><header><img src="https://acme.com/logo.svg" alt="Acme"></header></body></html>`,
      })
    );
    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ url: "https://acme.com/logo.svg", source_page: "header_img" });
  });

  it("falls back to /press then /brand pages when the homepage has nothing", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "https://acme.com": `<html><body>no logo here</body></html>`,
        "https://acme.com/press": `<html><body><img src="https://acme.com/press-logo.png" alt="logo"></body></html>`,
      })
    );
    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ url: "https://acme.com/press-logo.png", source_page: "/press" });
  });

  it("reports null honestly (never fabricates) when nothing is found anywhere", async () => {
    vi.stubGlobal("fetch", stubFetch({ "https://acme.com": `<html><body>nothing</body></html>` }));
    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ url: null, format: null, source_page: null });
  });
});
