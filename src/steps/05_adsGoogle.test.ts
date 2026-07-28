import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const { runActorMock } = vi.hoisted(() => ({ runActorMock: vi.fn() }));

vi.mock("../providers/apify.js", () => ({ runActor: (...args: unknown[]) => runActorMock(...args) }));
vi.mock("../db.js", () => ({ APIFY_ACTOR_GOOGLE_ADS: "test-google-ads-actor", APIFY_TOKEN: "test-token" }));

import step from "./05_adsGoogle.js";

function makeLead(domain: string | null): LeadRow {
  return { id: "lead-1", step_status: {}, company_data: { merged: { domain } } };
}

describe("step 05 ads_google", () => {
  beforeEach(() => {
    runActorMock.mockReset();
  });

  it("domain-searches and counts returned creatives", async () => {
    runActorMock.mockResolvedValue({
      items: [{ creativeId: "a" }, { creativeId: "b" }, { creativeId: "c" }],
      runCost_usd: 0.03,
      runId: "r1",
    });
    const result = await step.run(makeLead("smartlead.ai"));
    if (!("data" in result)) throw new Error("expected data");
    expect((result.data as Record<string, unknown>).count).toBe(3);
    expect(runActorMock).toHaveBeenCalledWith(
      "test-google-ads-actor",
      { domain: "smartlead.ai", maxItems: 100, region: "" },
      expect.anything()
    );
  });

  it("missing = 0: empty dataset is a done step with count 0", async () => {
    runActorMock.mockResolvedValue({ items: [], runCost_usd: 0, runId: "r2" });
    const result = await step.run(makeLead("smartlead.ai"));
    if (!("data" in result)) throw new Error("expected data");
    expect((result.data as Record<string, unknown>).count).toBe(0);
  });

  it("missing = 0: no domain means count 0 without calling the actor", async () => {
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
    vi.doMock("../db.js", () => ({ APIFY_ACTOR_GOOGLE_ADS: "test-google-ads-actor", APIFY_TOKEN: "" }));
    const { default: tokenlessStep } = await import("./05_adsGoogle.js");

    const result = await tokenlessStep.run(makeLead("smartlead.ai"));

    expect(runActorMock).not.toHaveBeenCalled();
    if (!("data" in result)) throw new Error("expected data, not a skip or error");
    expect((result.data as Record<string, unknown>).count).toBe(0);
    vi.doUnmock("../db.js");
  });
});
