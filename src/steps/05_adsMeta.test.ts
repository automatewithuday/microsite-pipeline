import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const { runActorMock } = vi.hoisted(() => ({ runActorMock: vi.fn() }));

vi.mock("../providers/apify.js", () => ({ runActor: (...args: unknown[]) => runActorMock(...args) }));
vi.mock("../db.js", () => ({ APIFY_ACTOR_META_ADS: "test-meta-ads-actor", APIFY_TOKEN: "test-token" }));

import step from "./05_adsMeta.js";

function makeLead(name: string | null, domain: string | null = "smartlead.ai"): LeadRow {
  return { id: "lead-1", step_status: {}, company_data: { merged: { name, domain } } };
}

describe("step 05 ads_meta", () => {
  beforeEach(() => {
    runActorMock.mockReset();
  });

  it("keyword-searches by company name and counts only the matching advertiser's ads", async () => {
    runActorMock.mockResolvedValue({
      items: [
        { pageId: "111", snapshot: { pageName: "Smartlead AI", caption: "https://smartlead.ai/get_started" } },
        { pageId: "111", snapshot: { pageName: "Smartlead AI" } },
        { pageId: "222", snapshot: { pageName: "Lusha", caption: "Lusha.com" } },
      ],
      runCost_usd: 0.03,
      runId: "r1",
    });
    const result = await step.run(makeLead("Smartlead"));
    if (!("data" in result)) throw new Error("expected data");
    expect((result.data as Record<string, unknown>).count).toBe(2);
    expect(result.cost_usd).toBe(0.03);

    const call = runActorMock.mock.calls[0] as [string, Record<string, unknown>, unknown];
    expect(call[0]).toBe("test-meta-ads-actor");
    expect(call[1]).toMatchObject({ resultsLimit: 100 });
    const url = (call[1] as { startUrls: [{ url: string }] }).startUrls[0].url;
    expect(url).toContain("country=ALL");
    expect(url).toContain("q=Smartlead");
    expect(url).toContain("search_type=keyword_unordered");
  });

  it("missing = 0: empty dataset is a done step with count 0, not skipped", async () => {
    runActorMock.mockResolvedValue({ items: [], runCost_usd: 0, runId: "r2" });
    const result = await step.run(makeLead("Smartlead"));
    expect("skipped" in result).toBe(false);
    if (!("data" in result)) throw new Error("expected data");
    expect((result.data as Record<string, unknown>).count).toBe(0);
  });

  it("missing = 0: no company name means count 0 without calling the actor", async () => {
    const result = await step.run(makeLead(null));
    expect(runActorMock).not.toHaveBeenCalled();
    if (!("data" in result)) throw new Error("expected data");
    expect((result.data as Record<string, unknown>).count).toBe(0);
  });

  it("a genuine thrown actor error propagates (step error, not count 0)", async () => {
    runActorMock.mockRejectedValue(new Error("apify actor crashed"));
    await expect(step.run(makeLead("Smartlead"))).rejects.toThrow("apify actor crashed");
  });

  // .env.example ships a default actor id, so without this guard a keyless run
  // calls Apify unauthenticated, stalls on the paywall until the step times
  // out, and lands in "error" — which blocks sales_signals and kills the deck.
  it("missing = 0: no APIFY_TOKEN means count 0 without calling the actor", async () => {
    vi.resetModules();
    vi.doMock("../db.js", () => ({ APIFY_ACTOR_META_ADS: "test-meta-ads-actor", APIFY_TOKEN: "" }));
    const { default: tokenlessStep } = await import("./05_adsMeta.js");

    const result = await tokenlessStep.run(makeLead("Smartlead"));

    expect(runActorMock).not.toHaveBeenCalled();
    if (!("data" in result)) throw new Error("expected data, not a skip or error");
    expect((result.data as Record<string, unknown>).count).toBe(0);
    vi.doUnmock("../db.js");
  });
});
