import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const { runActorMock } = vi.hoisted(() => ({ runActorMock: vi.fn() }));

vi.mock("../providers/apify.js", () => ({ runActor: (...args: unknown[]) => runActorMock(...args) }));
vi.mock("../db.js", () => ({ ADS_TRAFFIC_PROVIDER: "auto", DEEPLINE_API_KEY: "", APIFY_ACTOR_LINKEDIN_ADS: "test-linkedin-ads-actor", APIFY_TOKEN: "test-token" }));

import step from "./05_adsLinkedin.js";

function makeLead(name: string | null): LeadRow {
  return { id: "lead-1", step_status: {}, company_data: { merged: { name } } };
}

describe("step 05 ads_linkedin", () => {
  beforeEach(() => {
    runActorMock.mockReset();
  });

  it("queries an ?accountOwner= Ad Library URL for the company, with a maxRecords cap", async () => {
    runActorMock.mockResolvedValue({ items: [{ advertiser: { name: "Acme Inc" } }], runCost_usd: 0.01, runId: "r1" });
    await step.run(makeLead("Acme Inc"));
    const [, input] = runActorMock.mock.calls[0] as [string, Record<string, unknown>];
    const url = (input.urls as { url: string }[])[0]?.url ?? "";
    expect(url).toContain("linkedin.com/ad-library/search?accountOwner=");
    expect(url).toContain(encodeURIComponent("Acme Inc"));
    expect(input.maxRecords).toBeGreaterThan(0);
  });

  it("counts only the company's own ads, dropping collision advertisers", async () => {
    // ?accountOwner=Acme also returns unrelated advertisers whose name merely
    // contains it (live: Resend -> "Carlos Resende"); only own ads count.
    runActorMock.mockResolvedValue({
      items: [
        { advertiser: { name: "Acme Inc" } },
        { advertiser: { name: "Acme Inc" } },
        { advertiser: { name: "Acmezilla Roofing" } },
        { advertiser: null },
      ],
      runCost_usd: 0.01,
      runId: "r2",
    });
    const result = await step.run(makeLead("Acme Inc"));
    if (!("data" in result)) throw new Error("expected data");
    expect((result.data as Record<string, unknown>).count).toBe(2);
  });

  it("missing = 0: no company name means count 0 without calling the actor", async () => {
    const result = await step.run(makeLead(null));
    expect(runActorMock).not.toHaveBeenCalled();
    if (!("data" in result)) throw new Error("expected data");
    expect((result.data as Record<string, unknown>).count).toBe(0);
  });

  // .env.example ships a default actor id, so without this guard a keyless run
  // calls Apify unauthenticated, stalls on the paywall until the step times
  // out, and lands in "error" — which blocks sales_signals and kills the deck.
  it("missing = 0: no APIFY_TOKEN means count 0 without calling the actor", async () => {
    vi.resetModules();
    vi.doMock("../db.js", () => ({ ADS_TRAFFIC_PROVIDER: "auto", DEEPLINE_API_KEY: "", APIFY_ACTOR_LINKEDIN_ADS: "test-linkedin-ads-actor", APIFY_TOKEN: "" }));
    const { default: tokenlessStep } = await import("./05_adsLinkedin.js");

    const result = await tokenlessStep.run(makeLead("Smartlead"));

    expect(runActorMock).not.toHaveBeenCalled();
    if (!("data" in result)) throw new Error("expected data, not a skip or error");
    expect((result.data as Record<string, unknown>).count).toBe(0);
    vi.doUnmock("../db.js");
  });
});
