import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const { parallelMock, perplexityMock, llmMock, providerState } = vi.hoisted(() => ({
  parallelMock: vi.fn(),
  perplexityMock: vi.fn(),
  llmMock: vi.fn(),
  providerState: { provider: "claude" },
}));

vi.mock("../providers/parallel.js", () => ({
  runParallelDeepResearch: (...args: unknown[]) => parallelMock(...args),
}));
vi.mock("../providers/perplexity.js", () => ({
  runPerplexityResearch: (...args: unknown[]) => perplexityMock(...args),
}));
vi.mock("../providers/llm.js", () => ({
  runLlm: (...args: unknown[]) => llmMock(...args),
}));
// A getter lets each test flip the provider; the step reads RESEARCH_PROVIDER
// at call time, so the live binding reflects providerState.provider.
vi.mock("../db.js", () => ({
  get RESEARCH_PROVIDER() {
    return providerState.provider;
  },
}));

import step from "./07_research.js";

function makeLead(companyName: string | null, domain = "acme.com"): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company: companyName,
    company_data: { merged: { name: companyName, domain, description: "A widget company.", website: domain } },
  };
}

describe("step 07 research", () => {
  beforeEach(() => {
    parallelMock.mockReset();
    perplexityMock.mockReset();
    llmMock.mockReset();
    providerState.provider = "claude";
  });

  it("skips when there is no company name at all", async () => {
    const result = await step.run({ id: "lead-1", step_status: {}, company_data: {} });
    expect(result).toEqual({ skipped: "no company name available for research" });
    expect(llmMock).not.toHaveBeenCalled();
    expect(parallelMock).not.toHaveBeenCalled();
  });

  it("declares maxRetries: 1, not the pipeline default of 2", () => {
    expect(step.maxRetries).toBe(1);
  });

  describe("default: Claude with web search", () => {
    it("enables web search, interpolates the prompt, and passes the CLI directive", async () => {
      llmMock.mockResolvedValue({
        text: "## Research\n...",
        raw: '{"result":"..."}',
        cost_usd: 0.3,
        provider: "claude-cli:sonnet",
        subscription: true,
      });
      const result = await step.run(makeLead("Acme Inc"));

      expect(llmMock).toHaveBeenCalledTimes(1);
      const [prompt, opts] = llmMock.mock.calls[0] as [
        string,
        { webSearch?: boolean; cliWebSearchDirective?: string; tier: string },
      ];
      expect(prompt).toContain("Acme Inc");
      expect(prompt).toContain("acme.com");
      expect(prompt).not.toMatch(/—/);
      expect(opts.webSearch).toBe(true);
      expect(opts.tier).toBe("sonnet");
      // The web-search directive is passed for the CLI path, not baked into the prompt.
      expect(opts.cliWebSearchDirective?.toLowerCase()).toContain("web search");

      if (!("data" in result)) throw new Error("expected data");
      expect(result.provider).toBe("claude-cli:sonnet");
      expect(result.data).toMatchObject({
        response: "## Research\n...",
        provider: "claude-cli:sonnet",
        cost_note: "claude subscription, not per-call billed",
      });
    });

    it("records cost_usd 0 (subscription) but preserves the api-equivalent cost", async () => {
      llmMock.mockResolvedValue({
        text: "brief",
        raw: '{"result":"brief"}',
        cost_usd: 0.42,
        provider: "claude-cli:sonnet",
        subscription: true,
      });
      const result = await step.run(makeLead("Acme Inc"));
      if (!("data" in result)) throw new Error("expected data");
      expect(result.cost_usd).toBe(0);
      expect((result.data as Record<string, unknown>).api_equivalent_cost_usd).toBe(0.42);
      expect((result.data as Record<string, unknown>).cost_unknown).toBeUndefined();
    });

    it("records the real per-call cost on the Anthropic API path", async () => {
      llmMock.mockResolvedValue({
        text: "brief",
        raw: '{"id":"msg_1"}',
        cost_usd: 0.08,
        provider: "anthropic:claude-sonnet-4-6",
        subscription: false,
      });
      const result = await step.run(makeLead("Acme Inc"));
      if (!("data" in result)) throw new Error("expected data");
      expect(result.cost_usd).toBe(0.08);
      expect(result.provider).toBe("anthropic:claude-sonnet-4-6");
      expect((result.data as Record<string, unknown>).cost_note).toBeUndefined();
    });

    it("stores the full raw envelope", async () => {
      llmMock.mockResolvedValue({
        text: "brief",
        raw: '{"result":"brief","total_cost_usd":0.1}',
        cost_usd: 0.1,
        provider: "claude-cli:sonnet",
        subscription: true,
      });
      const result = await step.run(makeLead("Acme Inc"));
      if (!("data" in result)) throw new Error("expected data");
      expect((result.data as Record<string, unknown>).raw).toBe('{"result":"brief","total_cost_usd":0.1}');
    });
  });

  describe("RESEARCH_PROVIDER=parallel", () => {
    beforeEach(() => {
      providerState.provider = "parallel";
    });

    it("calls Parallel and interpolates the prompt with company fields", async () => {
      parallelMock.mockResolvedValue({ text: "## Research\n...", raw: { run_id: "r1" } });
      const result = await step.run(makeLead("Acme Inc"));

      expect(parallelMock).toHaveBeenCalledTimes(1);
      const [prompt] = parallelMock.mock.calls[0] as [string, number];
      expect(prompt).toContain("Acme Inc");
      expect(prompt).not.toMatch(/—/);

      if (!("data" in result)) throw new Error("expected data");
      expect(result.data).toMatchObject({ response: "## Research\n...", provider: "parallel" });
      expect(result.provider).toBe("parallel");
      expect(llmMock).not.toHaveBeenCalled();
    });

    it("flags cost_unknown and records cost_usd 0 when the provider has no usable cost figure", async () => {
      parallelMock.mockResolvedValue({ text: "brief text", raw: { run_id: "r3" }, cost_usd: null });
      const result = await step.run(makeLead("Acme Inc"));
      if (!("data" in result)) throw new Error("expected data");
      expect((result.data as Record<string, unknown>).cost_unknown).toBe(true);
      expect(result.cost_usd).toBe(0);
    });

    it("uses the provider's real cost when a cost figure is present", async () => {
      parallelMock.mockResolvedValue({ text: "brief text", raw: { run_id: "r4" }, cost_usd: 0.35 });
      const result = await step.run(makeLead("Acme Inc"));
      if (!("data" in result)) throw new Error("expected data");
      expect((result.data as Record<string, unknown>).cost_unknown).toBeUndefined();
      expect(result.cost_usd).toBe(0.35);
    });
  });

  describe("RESEARCH_PROVIDER=perplexity", () => {
    beforeEach(() => {
      providerState.provider = "perplexity";
    });

    it("calls Perplexity Sonar", async () => {
      perplexityMock.mockResolvedValue({ text: "sonar text", raw: { id: "p1" }, cost_usd: 0.02 });
      const result = await step.run(makeLead("Acme Inc"));
      expect(perplexityMock).toHaveBeenCalledTimes(1);
      if (!("data" in result)) throw new Error("expected data");
      expect(result.provider).toBe("perplexity");
      expect(result.cost_usd).toBe(0.02);
      expect(llmMock).not.toHaveBeenCalled();
    });
  });
});
