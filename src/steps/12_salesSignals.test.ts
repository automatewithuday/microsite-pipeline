import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const runLlmMock = vi.hoisted(() => vi.fn());
vi.mock("../providers/llm.js", () => ({
  runLlm: async (...args: unknown[]) => ({
    provider: "claude-cli:sonnet",
    subscription: true,
    cost_usd: null,
    raw: "raw",
    ...(await runLlmMock(...args)),
  }),
}));

import step from "./12_salesSignals.js";

const shortSignal = "You run 40 Meta ads monthly but have no outbound motion in place today.";

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company_data: { merged: { name: "Acme Inc", domain: "acme.com" } },
    traffic: { totalVisits: 12345, paidSearchVisits: 3086 },
    ads_meta: { count: 40 },
    ads_google: { count: 5 },
    ads_linkedin: { count: 0 },
    crm: { platform: "HubSpot" },
    sdr: { peopleCount: 2 },
    founders: { num_followers: 15000 },
    research: { response: "Acme sells widgets to mid-market retailers." },
    ...overrides,
  };
}

describe("step 12 sales_signals", () => {
  beforeEach(() => {
    runLlmMock.mockReset();
  });

  it("skips when required placeholder data is missing (no company name and no research)", async () => {
    const result = await step.run(makeLead({ company_data: {}, company: null, research: null }));
    expect(result).toEqual({
      skipped: "no company name or research response available for sales signals",
    });
    expect(runLlmMock).not.toHaveBeenCalled();
  });

  it("interpolates every data field into the prompt and calls the Sonnet model", async () => {
    runLlmMock.mockResolvedValue({
      text: JSON.stringify({ signals: [shortSignal, shortSignal, shortSignal] }),
      raw: "raw envelope",
      cost_usd: null,
    });
    await step.run(makeLead());

    const [prompt, opts] = runLlmMock.mock.calls[0] as [string, { tier: string; timeoutMs: number }];
    expect(prompt).toContain("Acme Inc");
    expect(prompt).toContain("12345");
    expect(prompt).toContain("3086");
    expect(prompt).toContain("Meta ads live: 40");
    expect(prompt).toContain("LinkedIn ads live: 0");
    expect(prompt).toContain("Google ads live: 5");
    expect(prompt).toContain("HubSpot");
    expect(prompt).toContain("SDR/BDR headcount: 2");
    expect(prompt).toContain("15000");
    expect(prompt).toContain("Acme sells widgets to mid-market retailers.");
    expect(prompt).not.toMatch(/—/);
    expect(opts.tier).toBe("sonnet");
  });

  it("stores exactly 3 validated signals plus raw envelope", async () => {
    runLlmMock.mockResolvedValue({
      text: JSON.stringify({ signals: [shortSignal, shortSignal, shortSignal] }),
      raw: "raw text",
      cost_usd: null,
    });
    const result = await step.run(makeLead());

    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as Record<string, unknown>;
    expect(data.signals).toEqual([shortSignal, shortSignal, shortSignal]);
    expect(data.raw).toBe("raw text");
    expect(result.cost_usd).toBe(0);
    expect(result.provider).toMatch(/^claude-cli:/);
  });

  it("throws (step error) when fewer than 3 signals are returned", async () => {
    runLlmMock.mockResolvedValue({
      text: JSON.stringify({ signals: [shortSignal, shortSignal] }),
      raw: "r",
      cost_usd: null,
    });
    await expect(step.run(makeLead())).rejects.toThrow();
  });

  it("throws (step error) when a signal exceeds 25 words", async () => {
    const longSignal = Array.from({ length: 26 }, (_, i) => `word${i}`).join(" ");
    runLlmMock.mockResolvedValue({
      text: JSON.stringify({ signals: [shortSignal, shortSignal, longSignal] }),
      raw: "r",
      cost_usd: null,
    });
    await expect(step.run(makeLead())).rejects.toThrow();
  });

  it("throws (step error) on unparsable output", async () => {
    runLlmMock.mockResolvedValue({ text: "here are some thoughts, no JSON", raw: "r", cost_usd: null });
    await expect(step.run(makeLead())).rejects.toThrow();
  });

  it("declares its full dependency list", () => {
    expect(step.dependsOn).toEqual([
      "crm",
      "traffic",
      "ads_meta",
      "ads_google",
      "ads_linkedin",
      "founders",
      "sdr",
      "research",
    ]);
  });

  it("declares maxRetries: 1", () => {
    expect(step.maxRetries).toBe(1);
  });
});
