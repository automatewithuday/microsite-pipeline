import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const runLlmMock = vi.hoisted(() => vi.fn());
// The step calls runLlm; the wrapper injects the provider/subscription fields
// (defaulting to the subscription CLI path) so each test only supplies text/raw/cost.
vi.mock("../providers/llm.js", () => ({
  runLlm: async (...args: unknown[]) => ({
    provider: "claude-cli:haiku",
    subscription: true,
    cost_usd: null,
    raw: "raw",
    ...(await runLlmMock(...args)),
  }),
}));

import step from "./10_tam.js";

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company_data: { merged: { domain: "acme.com" } },
    research: { response: "Acme sells widgets to mid-market retailers." },
    ...overrides,
  };
}

describe("step 10 tam", () => {
  beforeEach(() => {
    runLlmMock.mockReset();
  });

  it("skips when company domain is null", async () => {
    const result = await step.run(makeLead({ company_data: {} }));
    expect(result).toEqual({ skipped: "company domain is null" });
    expect(runLlmMock).not.toHaveBeenCalled();
  });

  it("skips when there is no research response", async () => {
    const result = await step.run(makeLead({ research: null }));
    expect(result).toEqual({ skipped: "no research response available" });
    expect(runLlmMock).not.toHaveBeenCalled();
  });

  it("interpolates domain and research into the prompt and calls the Haiku model", async () => {
    runLlmMock.mockResolvedValue({ text: '{"tamEstimation": 4200}', raw: "raw envelope", cost_usd: null });
    await step.run(makeLead());

    expect(runLlmMock).toHaveBeenCalledTimes(1);
    const [prompt, opts] = runLlmMock.mock.calls[0] as [string, { tier: string; timeoutMs: number }];
    expect(prompt).toContain("acme.com");
    expect(prompt).toContain("Acme sells widgets to mid-market retailers.");
    expect(opts.tier).toBe("haiku");
  });

  it("parses a fenced JSON response and stores tamEstimation plus raw envelope", async () => {
    runLlmMock.mockResolvedValue({
      text: '```json\n{"tamEstimation": 900}\n```',
      raw: "raw envelope text",
      cost_usd: null,
    });
    const result = await step.run(makeLead());

    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ tamEstimation: 900, raw: "raw envelope text" });
    expect(result.cost_usd).toBe(0);
    expect(result.provider).toMatch(/^claude-cli:/);
  });

  it("sets a cost_note instead of cost_unknown since this is subscription-billed", async () => {
    runLlmMock.mockResolvedValue({ text: '{"tamEstimation": 4200}', raw: "raw", cost_usd: null });
    const result = await step.run(makeLead());
    if (!("data" in result)) throw new Error("expected data");
    expect((result.data as Record<string, unknown>).cost_note).toBe(
      "claude subscription, not per-call billed"
    );
    expect((result.data as Record<string, unknown>).cost_unknown).toBeUndefined();
  });

  it("stores the three scenario counts when the response provides them", async () => {
    runLlmMock.mockResolvedValue({
      text: '{"tamEstimation": 33200, "tamRealistic": 17000, "tamConservative": 8294}',
      raw: "raw",
      cost_usd: null,
    });
    const result = await step.run(makeLead());
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({
      tamEstimation: 33200,
      tamRealistic: 17000,
      tamConservative: 8294,
    });
  });

  it("stores null scenario counts when only tamEstimation is returned", async () => {
    runLlmMock.mockResolvedValue({ text: '{"tamEstimation": 11500}', raw: "raw", cost_usd: null });
    const result = await step.run(makeLead());
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({
      tamEstimation: 11500,
      tamRealistic: null,
      tamConservative: null,
    });
  });

  it("throws (step error) when tamEstimation is 0", async () => {
    runLlmMock.mockResolvedValue({ text: '{"tamEstimation": 0}', raw: "raw", cost_usd: null });
    await expect(step.run(makeLead())).rejects.toThrow();
  });

  it("throws (step error) when the response has no JSON object at all", async () => {
    runLlmMock.mockResolvedValue({ text: "I could not determine a TAM.", raw: "raw", cost_usd: null });
    await expect(step.run(makeLead())).rejects.toThrow();
  });

  it("throws (step error) when tamEstimation is missing", async () => {
    runLlmMock.mockResolvedValue({ text: "{}", raw: "raw", cost_usd: null });
    await expect(step.run(makeLead())).rejects.toThrow();
  });

  it("declares maxRetries: 1", () => {
    expect(step.maxRetries).toBe(1);
  });
});
