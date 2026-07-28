// Deepline Adyntel fallback for the three ads steps when Apify throws
// (e.g. monthly usage hard limit). One file because all three share the
// same db/apify/deepline mock configuration.

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

vi.mock("../db.js", () => ({
  ADS_TRAFFIC_PROVIDER: "auto",
  APIFY_ACTOR_META_ADS: "test-meta-actor",
  APIFY_ACTOR_GOOGLE_ADS: "test-google-actor",
  APIFY_ACTOR_LINKEDIN_ADS: "test-linkedin-actor",
  APIFY_TOKEN: "test-token",
  DEEPLINE_API_KEY: "test-deepline-key",
}));

import adsMeta from "./05_adsMeta.js";
import adsGoogle from "./05_adsGoogle.js";
import adsLinkedin from "./05_adsLinkedin.js";

function makeLead(): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company_data: { merged: { name: "ColdIQ", domain: "coldiq.com" } },
  };
}

function envelope(raw: unknown): Record<string, unknown> {
  return {
    status: "completed",
    toolResponse: { raw },
    billing: { credits_charged: 0.13, cost_usd: 0.013 },
  };
}

describe("ads steps - deepline adyntel fallback on Apify failure", () => {
  beforeEach(() => {
    runActorMock.mockReset();
    runActorMock.mockRejectedValue(new Error("Monthly usage hard limit exceeded"));
    executeToolMock.mockReset();
  });

  it("ads_meta falls back to adyntel_facebook and treats an empty raw as count 0", async () => {
    executeToolMock.mockResolvedValue(envelope(""));

    const result = await adsMeta.run(makeLead());
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as Record<string, unknown>;

    expect(executeToolMock).toHaveBeenCalledWith(
      "adyntel_facebook",
      { company_domain: "coldiq.com" },
      expect.any(Number)
    );
    expect(data.count).toBe(0);
    expect(result.provider).toBe("deepline:adyntel_facebook");
    expect(result.cost_usd).toBe(0.013);
  });

  it("ads_google falls back to adyntel_google and reads total_ad_count", async () => {
    executeToolMock.mockResolvedValue(envelope({ ads: [], total_ad_count: 44 }));

    const result = await adsGoogle.run(makeLead());
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as Record<string, unknown>;

    expect(executeToolMock).toHaveBeenCalledWith(
      "adyntel_google",
      { company_domain: "coldiq.com" },
      expect.any(Number)
    );
    expect(data.count).toBe(44);
    expect(result.provider).toBe("deepline:adyntel_google");
  });

  it("ads_linkedin falls back to adyntel_linkedin and reads total_ads", async () => {
    executeToolMock.mockResolvedValue(envelope({ total_ads: 251, ads: [{ id: 1 }] }));

    const result = await adsLinkedin.run(makeLead());
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as Record<string, unknown>;

    expect(executeToolMock).toHaveBeenCalledWith(
      "adyntel_linkedin",
      { company_domain: "coldiq.com" },
      expect.any(Number)
    );
    expect(data.count).toBe(251);
    expect(result.provider).toBe("deepline:adyntel_linkedin");
  });

  it("throws (step error, not silent 0) when the fallback payload is unrecognizable", async () => {
    executeToolMock.mockResolvedValue(envelope({ unexpected: "shape" }));
    await expect(adsGoogle.run(makeLead())).rejects.toThrow(/adyntel_google/);
  });

  it("stores the deepline envelope as raw for auditability", async () => {
    executeToolMock.mockResolvedValue(envelope({ total_ads: 251, ads: [] }));
    const result = await adsLinkedin.run(makeLead());
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as Record<string, unknown>;
    expect(data.raw).toEqual(envelope({ total_ads: 251, ads: [] }));
  });
});
