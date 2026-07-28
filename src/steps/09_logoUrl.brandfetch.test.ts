// Separate test file (own module registry) so BRANDFETCH_API_KEY can be
// mocked as set, exercising the Brandfetch-first branch of step 09.
// When .env leaves this key unset, this path is untested against a live
// Brandfetch response and needs live validation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const { fetchBrandfetchLogosMock } = vi.hoisted(() => ({ fetchBrandfetchLogosMock: vi.fn() }));

vi.mock("../providers/brandfetch.js", () => ({
  fetchBrandfetchLogos: (...args: unknown[]) => fetchBrandfetchLogosMock(...args),
}));
vi.mock("../providers/firecrawl.js", () => ({
  firecrawlScrapeRawHtml: vi.fn().mockResolvedValue(null),
  FIRECRAWL_PAGE_COST_USD: 0.001,
}));
vi.mock("../db.js", () => ({ BRANDFETCH_API_KEY: "test-brandfetch-key" }));

import step from "./09_logoUrl.js";

function makeLead(domain: string): LeadRow {
  return { id: "lead-1", step_status: {}, company_data: { merged: { domain, website: domain } } };
}

describe("step 09 logo (BRANDFETCH_API_KEY set)", () => {
  beforeEach(() => {
    fetchBrandfetchLogosMock.mockReset();
    // No real network calls: stub fetch to always fail, so the
    // Brandfetch-miss test exercises the fallback path deterministically
    // without hitting the real internet.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, text: async () => "" }) as Response)
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the Brandfetch wordmark selection and never falls through to Firecrawl when Brandfetch hits", async () => {
    fetchBrandfetchLogosMock.mockResolvedValue({
      logos: [
        { type: "icon", theme: "dark", formats: [{ src: "https://cdn.brandfetch.io/icon.svg", format: "svg" }] },
        { type: "logo", theme: "dark", formats: [{ src: "https://cdn.brandfetch.io/wordmark.svg", format: "svg" }] },
      ],
      raw: { id: "brand-1" },
    });

    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({
      url: "https://cdn.brandfetch.io/wordmark.svg",
      format: "svg",
      variant: "logo",
      source_page: "brandfetch",
    });
    expect(result.provider).toBe("brandfetch");
  });

  it("falls through to the Firecrawl-based fallback when Brandfetch finds nothing", async () => {
    fetchBrandfetchLogosMock.mockResolvedValue(null);
    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    // No global fetch is stubbed and Firecrawl is mocked to null, so the
    // fallback legitimately finds nothing: honest null, not fabricated.
    expect(result.data).toMatchObject({ url: null });
  });
});
