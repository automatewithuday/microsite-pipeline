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

import step from "./11_icpSegments.js";

const segment = {
  segmentName: "Mid-market SaaS ops teams",
  companyCharacteristic: "50-200 employees, PLG motion",
  keyPainPoint: "No dedicated outbound function",
  primaryBuyer: "VP Sales",
  differentiatingNeed: "Wants ABM without headcount",
};

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company_data: { merged: { name: "Acme Inc", domain: "acme.com" } },
    research: { response: "Acme sells widgets to mid-market retailers." },
    ...overrides,
  };
}

describe("step 11 icp_segments", () => {
  beforeEach(() => {
    runLlmMock.mockReset();
  });

  it("skips when there is no company name", async () => {
    const result = await step.run(makeLead({ company_data: {}, company: null }));
    expect(result).toEqual({ skipped: "no company name available for icp segments" });
    expect(runLlmMock).not.toHaveBeenCalled();
  });

  it("skips when there is no research response", async () => {
    const result = await step.run(makeLead({ research: null }));
    expect(result).toEqual({ skipped: "no research response available" });
    expect(runLlmMock).not.toHaveBeenCalled();
  });

  it("interpolates Company, domain, and research, and calls the Sonnet model", async () => {
    runLlmMock.mockResolvedValue({
      text: JSON.stringify({ segments: [segment, segment] }),
      raw: "raw envelope",
      cost_usd: null,
    });
    await step.run(makeLead());

    const [prompt, opts] = runLlmMock.mock.calls[0] as [string, { tier: string; timeoutMs: number }];
    expect(prompt).toContain("Acme Inc");
    expect(prompt).toContain("acme.com");
    expect(prompt).toContain("Acme sells widgets to mid-market retailers.");
    expect(opts.tier).toBe("sonnet");
  });

  it("stores exactly the validated segments plus raw envelope", async () => {
    runLlmMock.mockResolvedValue({
      text: JSON.stringify({ segments: [segment, segment, segment] }),
      raw: "raw text",
      cost_usd: null,
    });
    const result = await step.run(makeLead());

    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as Record<string, unknown>;
    expect(data.segments).toHaveLength(3);
    expect(data.raw).toBe("raw text");
    expect(result.cost_usd).toBe(0);
    expect(result.provider).toMatch(/^claude-cli:/);
  });

  it("throws (step error) when fewer than 2 segments are returned", async () => {
    runLlmMock.mockResolvedValue({ text: JSON.stringify({ segments: [segment] }), raw: "r", cost_usd: null });
    await expect(step.run(makeLead())).rejects.toThrow();
  });

  it("throws (step error) when a segment is missing a required field", async () => {
    const { primaryBuyer, ...incomplete } = segment;
    runLlmMock.mockResolvedValue({
      text: JSON.stringify({ segments: [incomplete, segment] }),
      raw: "r",
      cost_usd: null,
    });
    await expect(step.run(makeLead())).rejects.toThrow();
  });

  it("throws (step error) on unparsable output", async () => {
    runLlmMock.mockResolvedValue({ text: "sorry, I cannot help with that", raw: "r", cost_usd: null });
    await expect(step.run(makeLead())).rejects.toThrow();
  });

  it("declares maxRetries: 1", () => {
    expect(step.maxRetries).toBe(1);
  });
});
