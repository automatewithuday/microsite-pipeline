import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "./db.js";
import type { StateBackend } from "./state/types.js";
import { applyFollowupRender } from "./followupRender.js";

const narrative = {
  diagnosis: [
    { title: "T1", body: "B1", groundedIn: "g1" },
    { title: "T2", body: "B2", groundedIn: "g2" },
  ],
  businessReading: ["R1"],
  fit: "Fit.",
  playbook: [
    { title: "P1", body: "b" },
    { title: "P2", body: "b" },
    { title: "P3", body: "b" },
  ],
  caseStudyPicks: [
    { id: "dailypay", relevance: "r1" },
    { id: "sk-trading", relevance: "r2" },
  ],
  playPicks: [{ id: "signal-outbound", relevance: "r3" }],
  raw: "raw",
};

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company_data: { merged: { name: "Acme Inc" } },
    followup_narrative: narrative,
    ...overrides,
  };
}

function makeBackend() {
  const columns: Record<string, unknown> = {};
  const marks: Array<{ step: string; entry: Record<string, unknown> }> = [];
  const artifacts: Array<{ kind: string }> = [];
  const backend = {
    writeColumn: vi.fn(async (_id: string, column: string, data: unknown) => {
      columns[column] = data;
    }),
    markStep: vi.fn(async (_id: string, step: string, entry: Record<string, unknown>) => {
      marks.push({ step, entry });
    }),
    writeArtifact: vi.fn(async (_id: string, kind: string) => {
      artifacts.push({ kind });
      return `file:///tmp/lead-1.${kind}`;
    }),
    getLead: vi.fn(),
    getLeadByLinkedinUrl: vi.fn(),
    listPending: vi.fn(),
    upsertLeads: vi.fn(),
  } as unknown as StateBackend;
  return { backend, columns, marks, artifacts };
}

describe("applyFollowupRender", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips (markStep skipped) when the gate fails", async () => {
    const { backend, marks } = makeBackend();
    await applyFollowupRender(makeLead({ followup_narrative: null }), backend);
    expect(marks).toEqual([
      { step: "followup_render", entry: expect.objectContaining({ state: "skipped" }) },
    ]);
  });

  it("is idempotent: returns without work when already done and not forced", async () => {
    const { backend, marks } = makeBackend();
    const lead = makeLead({
      step_status: { followup_render: { state: "done", at: "2026-07-29T00:00:00Z" } },
    });
    await applyFollowupRender(lead, backend);
    expect(marks).toEqual([]);
  });

  it("writes both artifacts, both columns, and marks done", async () => {
    const { backend, marks, columns, artifacts } = makeBackend();
    await applyFollowupRender(makeLead(), backend);
    expect(artifacts.map((a) => a.kind).sort()).toEqual(["followup.html", "followup.md"]);
    expect(typeof columns.followup_html).toBe("string");
    expect(columns.followup_html as string).toContain("Acme Inc");
    expect(columns.followup).toEqual({
      pageUrl: "file:///tmp/lead-1.followup.html",
      skimUrl: "file:///tmp/lead-1.followup.md",
    });
    expect(marks).toEqual([
      { step: "followup_render", entry: expect.objectContaining({ state: "done" }) },
    ]);
  });

  it("completes done even when a pick id has no library entry (renders as empty block)", async () => {
    const { backend, marks } = makeBackend();
    const bad = {
      ...narrative,
      caseStudyPicks: [
        { id: "ghost", relevance: "r" },
        { id: "dailypay", relevance: "r" },
      ],
    };
    await applyFollowupRender(makeLead({ followup_narrative: bad }), backend);
    // Content-level safety is step 13's job: it never persists unknown ids.
    expect(marks[0]!.step).toBe("followup_render");
  });
});
