import { describe, expect, it } from "vitest";
import type { LeadRow } from "../db.js";
import type { ProofLibrary } from "./proofLibrary.js";
import { buildFollowupSkim, followupRenderGate, followupSlug, readNarrative } from "./followup.js";

const narrative = {
  diagnosis: [
    { title: "No outbound", body: "Body one.", groundedIn: "ads: 0 LinkedIn ads" },
    { title: "Paid reliance", body: "Body two.", groundedIn: "traffic: 62% paid" },
  ],
  businessReading: ["Reading one."],
  fit: "Operator layer.",
  playbook: [
    { title: "P1", body: "b1" },
    { title: "P2", body: "b2" },
    { title: "P3", body: "b3" },
  ],
  caseStudyPicks: [
    { id: "dailypay", relevance: "Same motion." },
    { id: "sk", relevance: "Same shape." },
  ],
  playPicks: [{ id: "signal", relevance: "None today." }],
};

const library: ProofLibrary = {
  profile: {
    positioning: "Fractional CMO.",
    locationLine: "Pune based.",
    calUrl: "https://cal.com/uday-kang/15min",
    repoLinks: [],
  },
  caseStudies: [
    {
      id: "dailypay",
      client: "DailyPay",
      verticalTags: ["fintech"],
      motionTags: ["outbound"],
      problem: "p",
      approach: "a",
      metrics: [{ value: "2,700+", label: "Demos booked" }],
    },
    {
      id: "sk",
      client: "SK Trading",
      verticalTags: ["consumer"],
      motionTags: ["content"],
      problem: "p",
      approach: "a",
      metrics: [{ value: "28%→11%", label: "Churn" }],
    },
  ],
  plays: [{ id: "signal", name: "Signal-based outbound", whenTags: ["outbound"], steps: ["s1"] }],
  platforms: [],
  plan30day: [{ title: "Audit", deliverables: ["d1"] }],
};

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company_data: { merged: { name: "Acme Inc" } },
    followup_narrative: { ...narrative, raw: "r" },
    ...overrides,
  };
}

describe("followupRenderGate", () => {
  it("passes when a valid narrative column exists", () => {
    expect(followupRenderGate(makeLead())).toEqual({ ok: true });
  });

  it("fails with a reason when the narrative column is missing", () => {
    const gate = followupRenderGate(makeLead({ followup_narrative: null }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("followup_narrative");
  });

  it("fails when the narrative column does not validate", () => {
    const gate = followupRenderGate(makeLead({ followup_narrative: { diagnosis: [] } }));
    expect(gate.ok).toBe(false);
  });
});

describe("followupSlug", () => {
  it("kebab-cases the company and appends -growth-plan", () => {
    expect(followupSlug("Acme Inc")).toBe("acme-inc-growth-plan");
  });
  it("strips punctuation and collapses dashes", () => {
    expect(followupSlug("Rare  Ideas, LLC!")).toBe("rare-ideas-llc-growth-plan");
  });
  it("appends a numeric suffix for collision attempts", () => {
    expect(followupSlug("Acme", 1)).toBe("acme-growth-plan-2");
    expect(followupSlug("Acme", 2)).toBe("acme-growth-plan-3");
  });
});

describe("buildFollowupSkim", () => {
  it("contains company, slug, every diagnosis title with groundedIn, and pick relevance lines", () => {
    const skim = buildFollowupSkim(makeLead(), library);
    expect(skim).toContain("Acme Inc");
    expect(skim).toContain("acme-inc-growth-plan");
    expect(skim).toContain("No outbound");
    expect(skim).toContain("ads: 0 LinkedIn ads");
    expect(skim).toContain("DailyPay");
    expect(skim).toContain("Same motion.");
    expect(skim).toContain("P1");
  });
});

describe("readNarrative", () => {
  it("returns null for an invalid column", () => {
    expect(readNarrative(makeLead({ followup_narrative: { nope: 1 } }))).toBeNull();
  });
  it("returns the validated narrative", () => {
    expect(readNarrative(makeLead())?.fit).toBe("Operator layer.");
  });
});
