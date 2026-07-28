import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const { runActorMock } = vi.hoisted(() => ({ runActorMock: vi.fn() }));

vi.mock("../providers/apify.js", () => ({
  runActor: (...args: unknown[]) => runActorMock(...args),
}));

vi.mock("../db.js", () => ({
  APIFY_ACTOR_SIMILARWEB: "test-similarweb-actor",
  APIFY_TOKEN: "test-token",
}));

import step from "./04_traffic.js";

function makeLead(domain: string | null): LeadRow {
  return { id: "lead-1", step_status: {}, company_data: { merged: { domain } } };
}

describe("step 04 traffic", () => {
  beforeEach(() => {
    runActorMock.mockReset();
  });

  it("skips when company domain is null", async () => {
    const result = await step.run(makeLead(null));
    expect(result).toEqual({ skipped: "company domain is null" });
    expect(runActorMock).not.toHaveBeenCalled();
  });

  it("extracts totalVisits and paidSearchVisits, storing raw items and cost", async () => {
    runActorMock.mockResolvedValue({
      items: [{ totalVisits: 200000, paidSearchShare: 0.1 }],
      runCost_usd: 0.01,
      runId: "run-1",
    });

    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toEqual({
      totalVisits: 200000,
      paidSearchVisits: 20000,
      source_field: "paidSearchShare",
      raw: [{ totalVisits: 200000, paidSearchShare: 0.1 }],
    });
    expect(result.cost_usd).toBe(0.01);
    expect(result.provider).toBe("apify:similarweb");
  });

  it("marks skipped (empty = skipped rule), not error, when the actor returns no data", async () => {
    runActorMock.mockResolvedValue({ items: [], runCost_usd: 0, runId: "run-2" });
    const result = await step.run(makeLead("tiny-new-domain.com"));
    expect(result).toEqual({ skipped: "no similarweb data" });
  });

  it("marks cost_unknown when the client reports no usage cost, without fabricating a number", async () => {
    runActorMock.mockResolvedValue({
      items: [{ totalVisits: 5000 }],
      runCost_usd: null,
      runId: "run-3",
    });
    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect((result.data as Record<string, unknown>).cost_unknown).toBe(true);
    expect(result.cost_usd).toBe(0);
  });

  // Without a token the actor call would block on Apify's paywall until the
  // step timed out, so it must skip before reaching the network.
  it("skips when APIFY_TOKEN is absent, without calling the actor", async () => {
    vi.resetModules();
    vi.doMock("../db.js", () => ({
      APIFY_ACTOR_SIMILARWEB: "test-similarweb-actor",
      APIFY_TOKEN: "",
    }));
    const { default: tokenlessStep } = await import("./04_traffic.js");

    const result = await tokenlessStep.run(makeLead("acme.com"));

    expect(runActorMock).not.toHaveBeenCalled();
    if (!("skipped" in result)) throw new Error("expected a skip");
    expect(result.skipped).toContain("APIFY_TOKEN");
    vi.doUnmock("../db.js");
  });
});
