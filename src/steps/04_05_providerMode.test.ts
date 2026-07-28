// ADS_TRAFFIC_PROVIDER routes steps 04/05 explicitly:
//   "apify"    — Apify only, Deepline never called, Apify errors propagate.
//   "deepline" — Deepline only, Apify never called even when configured.
// ("auto", the default, is covered by 04_traffic.fallback.test.ts and
// 05_adsFallback.test.ts.) Uses resetModules + doMock so each test can pin
// its own db.js switch values.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const { runActorMock, executeToolMock } = vi.hoisted(() => ({
  runActorMock: vi.fn(),
  executeToolMock: vi.fn(),
}));

vi.mock("../providers/apify.js", () => ({
  runActor: (...args: unknown[]) => runActorMock(...args),
}));

vi.mock("../providers/deepline.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
}));

function makeLead(): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company_data: { merged: { name: "ColdIQ", domain: "coldiq.com" } },
  };
}

function dbMockValues(adsTrafficProvider: string, deeplineKey = "test-deepline-key") {
  return {
    ADS_TRAFFIC_PROVIDER: adsTrafficProvider,
    DEEPLINE_API_KEY: deeplineKey,
    APIFY_TOKEN: "test-token",
    APIFY_ACTOR_SIMILARWEB: "test-similarweb-actor",
    APIFY_ACTOR_META_ADS: "test-meta-actor",
    APIFY_ACTOR_GOOGLE_ADS: "test-google-actor",
    APIFY_ACTOR_LINKEDIN_ADS: "test-linkedin-actor",
  };
}

async function loadStep(name: string, adsTrafficProvider: string, deeplineKey?: string) {
  vi.resetModules();
  vi.doMock("../db.js", () => dbMockValues(adsTrafficProvider, deeplineKey));
  return (await import(`./${name}.js`)).default;
}

describe("ADS_TRAFFIC_PROVIDER=apify", () => {
  beforeEach(() => {
    runActorMock.mockReset();
    executeToolMock.mockReset();
  });

  it("traffic propagates the Apify error without calling Deepline", async () => {
    const step = await loadStep("04_traffic", "apify");
    runActorMock.mockRejectedValue(new Error("Monthly usage hard limit exceeded"));
    await expect(step.run(makeLead())).rejects.toThrow("Monthly usage hard limit exceeded");
    expect(executeToolMock).not.toHaveBeenCalled();
  });

  it("ads_google propagates the Apify error without calling Deepline", async () => {
    const step = await loadStep("05_adsGoogle", "apify");
    runActorMock.mockRejectedValue(new Error("limit"));
    await expect(step.run(makeLead())).rejects.toThrow("limit");
    expect(executeToolMock).not.toHaveBeenCalled();
  });
});

describe("ADS_TRAFFIC_PROVIDER=deepline", () => {
  beforeEach(() => {
    runActorMock.mockReset();
    executeToolMock.mockReset();
  });

  it("traffic goes straight to the DataForSEO tool, never touching Apify", async () => {
    const step = await loadStep("04_traffic", "deepline");
    executeToolMock.mockResolvedValue({
      status: "completed",
      toolResponse: {
        raw: { tasks: [{ result: [{ items: [{ metrics: { organic: { etv: 100 }, paid: { etv: 0 } } }] }] }] },
      },
      billing: { cost_usd: 0.142 },
    });

    const result = await step.run(makeLead());
    if (!("data" in result)) throw new Error("expected data");
    expect(runActorMock).not.toHaveBeenCalled();
    expect(result.provider).toBe("deepline:dataforseo");
  });

  it("ads_linkedin goes straight to Adyntel, never touching Apify", async () => {
    const step = await loadStep("05_adsLinkedin", "deepline");
    executeToolMock.mockResolvedValue({
      status: "completed",
      toolResponse: { raw: { total_ads: 251, ads: [] } },
      billing: { cost_usd: 0.013 },
    });

    const result = await step.run(makeLead());
    if (!("data" in result)) throw new Error("expected data");
    expect(runActorMock).not.toHaveBeenCalled();
    expect(result.provider).toBe("deepline:adyntel_linkedin");
  });

  it("traffic skips with a clear reason when DEEPLINE_API_KEY is missing", async () => {
    const step = await loadStep("04_traffic", "deepline", "");
    const result = await step.run(makeLead());
    expect(result).toEqual({ skipped: "ADS_TRAFFIC_PROVIDER=deepline but DEEPLINE_API_KEY not configured" });
    expect(runActorMock).not.toHaveBeenCalled();
    expect(executeToolMock).not.toHaveBeenCalled();
  });

  it("ads_meta reports count 0 when DEEPLINE_API_KEY is missing (missing = 0 rule)", async () => {
    const step = await loadStep("05_adsMeta", "deepline", "");
    const result = await step.run(makeLead());
    if (!("data" in result)) throw new Error("expected data");
    expect((result.data as Record<string, unknown>).count).toBe(0);
    expect(runActorMock).not.toHaveBeenCalled();
    expect(executeToolMock).not.toHaveBeenCalled();
  });
});
