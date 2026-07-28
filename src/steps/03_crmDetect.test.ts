// Regression coverage for the secondary-page fetch discarding homepage HTML
// bug: when the homepage HTML was
// thin (<2000 chars), the old code unconditionally replaced it with the
// secondary page's HTML before ever running signature detection, losing a
// signature that was present on the thin homepage. No real network calls:
// global fetch is stubbed with fixtures for every URL the step can request.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";
import { _resetForTests as resetProviderCooldown } from "../providerCooldown.js";

import step from "./03_crmDetect.js";

const WEBSITE = "https://acme.com";
const HOMEPAGE_URL = "https://acme.com/";
const PRICING_URL = "https://acme.com/pricing";

function makeLead(website: string): LeadRow {
  return { id: "lead-1", step_status: {}, company_data: { merged: { website } } };
}

interface Routes {
  [url: string]: string | null;
}

function stubFetch(routes: Routes) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push(url);

    // Firecrawl is a distinct paid provider; simulate it having no result so
    // fetchHomepage falls back to whatever the plain fetch already got,
    // matching how these fixtures represent "thin homepage, no Firecrawl
    // upgrade available" without a real network call.
    if (url.startsWith("https://api.firecrawl.dev")) {
      return {
        ok: false,
        status: 500,
        json: async () => ({}),
      } as unknown as Response;
    }

    const key = Object.keys(routes).find((r) => r === url || `${r}/` === url || r === `${url}`);
    const html = key !== undefined ? routes[key] : undefined;
    if (html === undefined || html === null) {
      return { ok: false, status: 404, text: async () => "" } as unknown as Response;
    }
    return { ok: true, status: 200, text: async () => html } as unknown as Response;
  });
  return { impl, calls };
}

describe("step 03 crmDetect: homepage vs secondary page scan", () => {
  beforeEach(() => {
    resetProviderCooldown();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects HubSpot on a thin homepage and attributes it to the homepage, even with a signature-free secondary page", async () => {
    const homepageHtml = `<html><head><script src="https://js.hs-scripts.com/12345.js"></script></head></html>`;
    const secondaryHtml = `<html><body><h1>Pricing</h1><p>No CRM widget here.</p></body></html>`;

    const { impl, calls } = stubFetch({
      [WEBSITE]: homepageHtml,
      [HOMEPAGE_URL]: homepageHtml,
      [PRICING_URL]: secondaryHtml,
    });
    vi.stubGlobal("fetch", impl);

    const result = await step.run(makeLead(WEBSITE));

    if (!("data" in result)) throw new Error("expected a data result, got skipped");
    expect(result.data).toEqual({
      platform: "HubSpot",
      method: "signatures",
      matched: "js.hs-scripts.com",
      page: "homepage",
    });

    // The homepage already matched: the secondary page should never have
    // been requested.
    expect(calls).not.toContain(PRICING_URL);
  });

  it("falls through to a secondary page with a signature when the homepage is thin and signature-free", async () => {
    const homepageHtml = `<html><body><h1>Welcome</h1></body></html>`;
    const secondaryHtml = `<script src="https://leadbooster-chat.pipedrive.com/assets/loader.js"></script>`;

    const { impl } = stubFetch({
      [WEBSITE]: homepageHtml,
      [HOMEPAGE_URL]: homepageHtml,
      [PRICING_URL]: secondaryHtml,
    });
    vi.stubGlobal("fetch", impl);

    const result = await step.run(makeLead(WEBSITE));

    if (!("data" in result)) throw new Error("expected a data result, got skipped");
    expect(result.data).toEqual({
      platform: "Pipedrive",
      method: "signatures",
      matched: "leadbooster-chat.pipedrive.com",
      page: "/pricing",
    });
  });
});
