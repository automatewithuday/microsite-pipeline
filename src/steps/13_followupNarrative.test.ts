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

import step from "./13_followupNarrative.js";

const validNarrative = {
  diagnosis: [
    { title: "No outbound", body: "b", groundedIn: "ads: 0 LinkedIn ads" },
    { title: "Paid reliance", body: "b", groundedIn: "traffic: paid search share" },
  ],
  businessReading: ["Reading paragraph."],
  fit: "Operator layer.",
  playbook: [
    { title: "P1", body: "b1" },
    { title: "P2", body: "b2" },
    { title: "P3", body: "b3" },
  ],
  caseStudyPicks: [
    { id: "dailypay", relevance: "Same motion." },
    { id: "sk-trading", relevance: "Same shape." },
  ],
  playPicks: [{ id: "signal-outbound", relevance: "No outbound today." }],
};

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company_data: { merged: { name: "Acme Inc", domain: "acme.com" } },
    traffic: { totalVisits: 12345 },
    ads_meta: { count: 40 },
    ads_google: { count: 5 },
    ads_linkedin: { count: 0 },
    crm: { platform: "HubSpot" },
    research: { response: "Acme sells widgets." },
    tam: { tamEstimation: 20000 },
    icp_segments: { segments: [] },
    sales_signals: { signals: ["s1", "s2", "s3"] },
    ...overrides,
  };
}

describe("step 13 followup_narrative", () => {
  beforeEach(() => {
    runLlmMock.mockReset();
    delete process.env.FOLLOWUP_STEER;
  });

  it("skips when no company name and no research", async () => {
    const result = await step.run(makeLead({ company_data: {}, company: null, research: null }));
    expect(result).toEqual({
      skipped: "no company name or research response available for followup narrative",
    });
    expect(runLlmMock).not.toHaveBeenCalled();
  });

  it("interpolates prospect data and the library digest into the prompt", async () => {
    runLlmMock.mockResolvedValue({ text: JSON.stringify(validNarrative), cost_usd: null });
    await step.run(makeLead());
    const [prompt, opts] = runLlmMock.mock.calls[0] as [string, { tier: string }];
    expect(prompt).toContain("Acme Inc");
    expect(prompt).toContain("Acme sells widgets.");
    expect(prompt).toContain('case "dailypay"'); // digest from the real committed library
    expect(prompt).toContain('play "signal-outbound"');
    expect(opts.tier).toBe("sonnet");
  });

  it("stores the validated narrative plus raw envelope", async () => {
    runLlmMock.mockResolvedValue({ text: JSON.stringify(validNarrative), raw: "envelope", cost_usd: null });
    const result = await step.run(makeLead());
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as Record<string, unknown>;
    expect(data.diagnosis).toEqual(validNarrative.diagnosis);
    expect(data.caseStudyPicks).toEqual(validNarrative.caseStudyPicks);
    expect(data.raw).toBe("envelope");
    expect(result.cost_usd).toBe(0);
  });

  it("throws when a pick id is not in the library", async () => {
    const bad = {
      ...validNarrative,
      caseStudyPicks: [{ id: "not-a-real-id", relevance: "r" }, validNarrative.caseStudyPicks[0]!],
    };
    runLlmMock.mockResolvedValue({ text: JSON.stringify(bad), cost_usd: null });
    await expect(step.run(makeLead())).rejects.toThrow(/not-a-real-id/);
  });

  it("throws on unparsable output", async () => {
    runLlmMock.mockResolvedValue({ text: "no json here", cost_usd: null });
    await expect(step.run(makeLead())).rejects.toThrow();
  });

  it("includes FOLLOWUP_STEER in the prompt when set", async () => {
    process.env.FOLLOWUP_STEER = "Lean into the retention angle";
    runLlmMock.mockResolvedValue({ text: JSON.stringify(validNarrative), cost_usd: null });
    await step.run(makeLead());
    const [prompt] = runLlmMock.mock.calls[0] as [string];
    expect(prompt).toContain("Lean into the retention angle");
  });

  it("declares its full dependency list", () => {
    expect(step.dependsOn).toEqual([
      "company",
      "crm",
      "traffic",
      "ads_meta",
      "ads_google",
      "ads_linkedin",
      "research",
      "tam",
      "icp_segments",
      "sales_signals",
    ]);
  });

  it("declares maxRetries: 1", () => {
    expect(step.maxRetries).toBe(1);
  });
});
