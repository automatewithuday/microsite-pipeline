import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const { parallelMock, perplexityMock } = vi.hoisted(() => ({
  parallelMock: vi.fn(),
  perplexityMock: vi.fn(),
}));

vi.mock("../providers/parallel.js", () => ({
  runParallelDeepResearch: (...args: unknown[]) => parallelMock(...args),
}));
vi.mock("../providers/perplexity.js", () => ({
  runPerplexityResearch: (...args: unknown[]) => perplexityMock(...args),
}));
vi.mock("../db.js", () => ({ RESEARCH_PROVIDER: "perplexity" }));

import step from "./07_research.js";

function makeLead(companyName: string): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company: companyName,
    company_data: { merged: { name: companyName, domain: "acme.com", website: "acme.com" } },
  };
}

describe("step 07 research (RESEARCH_PROVIDER=perplexity)", () => {
  beforeEach(() => {
    parallelMock.mockReset();
    perplexityMock.mockReset();
  });

  it("uses Perplexity instead of Parallel, and reports its real token-based cost", async () => {
    perplexityMock.mockResolvedValue({ text: "brief", raw: { id: "p1" }, cost_usd: 0.0042 });
    const result = await step.run(makeLead("Acme Inc"));

    expect(parallelMock).not.toHaveBeenCalled();
    expect(perplexityMock).toHaveBeenCalledTimes(1);
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ response: "brief", provider: "perplexity" });
    expect(result.cost_usd).toBe(0.0042);
    expect((result.data as Record<string, unknown>).cost_unknown).toBeUndefined();
  });

  it("flags cost_unknown when Perplexity has no usable cost figure", async () => {
    perplexityMock.mockResolvedValue({ text: "brief", raw: { id: "p2" }, cost_usd: null });
    const result = await step.run(makeLead("Acme Inc"));

    if (!("data" in result)) throw new Error("expected data");
    expect((result.data as Record<string, unknown>).cost_unknown).toBe(true);
    expect(result.cost_usd).toBe(0);
  });
});
