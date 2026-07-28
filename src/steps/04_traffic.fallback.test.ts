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
  APIFY_ACTOR_SIMILARWEB: "test-similarweb-actor",
  APIFY_TOKEN: "test-token",
  DEEPLINE_API_KEY: "test-deepline-key",
}));

import step from "./04_traffic.js";

function makeLead(domain: string | null): LeadRow {
  return { id: "lead-1", step_status: {}, company_data: { merged: { domain } } };
}

function dataforseoEnvelope(): Record<string, unknown> {
  return {
    status: "completed",
    toolResponse: {
      raw: {
        tasks: [
          {
            result: [
              { items: [{ metrics: { organic: { etv: 36860.28 }, paid: { etv: 120.5 } } }] },
            ],
          },
        ],
      },
    },
    billing: { credits_charged: 1.42, cost_usd: 0.142 },
  };
}

describe("step 04 traffic - deepline fallback", () => {
  beforeEach(() => {
    runActorMock.mockReset();
    executeToolMock.mockReset();
  });

  it("falls back to the dataforseo tool when the Apify call throws", async () => {
    runActorMock.mockRejectedValue(new Error("Monthly usage hard limit exceeded"));
    executeToolMock.mockResolvedValue(dataforseoEnvelope());

    const result = await step.run(makeLead("coldiq.com"));
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as Record<string, unknown>;

    expect(executeToolMock).toHaveBeenCalledWith(
      "dataforseo_dataforseo_labs_google_domain_rank_overview_live",
      { target: "coldiq.com", location_code: 2840, language_code: "en" },
      expect.any(Number)
    );
    expect(data).toMatchObject({
      totalVisits: 36981,
      paidSearchVisits: 121,
      source_field: "dataforseo_etv",
    });
    expect(result.provider).toBe("deepline:dataforseo");
    expect(result.cost_usd).toBe(0.142);
  });

  it("stores the full deepline envelope as raw for auditability", async () => {
    runActorMock.mockRejectedValue(new Error("limit"));
    executeToolMock.mockResolvedValue(dataforseoEnvelope());

    const result = await step.run(makeLead("coldiq.com"));
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as Record<string, unknown>;
    expect(data.raw).toEqual(dataforseoEnvelope());
  });

  it("skips when the fallback returns no usable data", async () => {
    runActorMock.mockRejectedValue(new Error("limit"));
    executeToolMock.mockResolvedValue({ status: "no_result", toolResponse: { raw: { tasks: [] } } });

    const result = await step.run(makeLead("coldiq.com"));
    expect(result).toEqual({ skipped: "no dataforseo data" });
  });
});
