import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LeadRow } from "./db.js";

const pdfMock = vi.fn();
const setContentMock = vi.fn();
const closeMock = vi.fn();
const launchMock = vi.fn();

vi.mock("playwright", () => ({
  chromium: {
    launch: (...args: unknown[]) => launchMock(...args),
  },
}));

vi.mock("./db.js", () => ({
  RENDER_STRICT: false,
  getStepState: (lead: { step_status?: Record<string, { state?: string }> }, step: string) =>
    lead.step_status?.[step]?.state,
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () =>
    '<html><head></head><body><section data-label="Cover">[Company]</section></body></html>'
  ),
}));

import { applyRender } from "./render.js";

// Fake StateBackend: only the members applyRender uses. writeArtifact returns
// a pdf/page URL per kind, mirroring what the real backends return.
function fakePersistence() {
  return {
    writeColumn: vi.fn(async () => {}),
    markStep: vi.fn(async () => {}),
    writeArtifact: vi.fn(async (leadId: string, kind: "pdf" | "html") =>
      kind === "pdf"
        ? `https://store.example/${leadId}.pdf`
        : `https://sites.example/d/${leadId}`
    ),
    getLead: vi.fn(),
    getLeadByLinkedinUrl: vi.fn(),
    listPending: vi.fn(),
    upsertLeads: vi.fn(),
  };
}

function goodLead(overrides: Record<string, unknown> = {}): LeadRow {
  return {
    id: "8442b5a1", company: "Acme", qualified: true, step_status: {},
    tam: { tamEstimation: 2000000 },
    icp_segments: { segments: [
      { segmentName: "S1", companyCharacteristic: "C1", keyPainPoint: "P1", primaryBuyer: "B1", differentiatingNeed: "N1" },
      { segmentName: "S2", companyCharacteristic: "C2", keyPainPoint: "P2", primaryBuyer: "B2", differentiatingNeed: "N2" },
    ] },
    sales_signals: { signals: ["s1", "s2", "s3"] },
    logo: { url: "https://l.example/l.png" },
    brand_colors: { primary: "#F5EFE6", secondary: "#FF4D00" },
    company_data: { merged: { name: "Acme Inc" } },
    derived: { paidSearchPct: "40%", liFollowersInsight: "1,200", adSummary: "x", sdrInsight: "y", crmPlatform: "HubSpot", adjustedTam: "1,800,000", adjustedTam2: "1,200,000" },
    ...overrides,
  } as unknown as LeadRow;
}

beforeEach(() => {
  pdfMock.mockReset().mockResolvedValue(Buffer.from("%PDF-fake"));
  setContentMock.mockReset().mockResolvedValue(undefined);
  closeMock.mockReset().mockResolvedValue(undefined);
  launchMock.mockReset().mockResolvedValue({
    newPage: vi.fn(async () => ({ setContent: setContentMock, pdf: pdfMock })),
    close: closeMock,
  });
});

describe("applyRender", () => {
  it("skips when already done and not forced", async () => {
    const p = fakePersistence();
    await applyRender(goodLead({ step_status: { render: { state: "done" } } }), p);
    expect(p.writeColumn).not.toHaveBeenCalled();
    expect(p.markStep).not.toHaveBeenCalled();
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("re-renders when done but forced", async () => {
    const p = fakePersistence();
    await applyRender(goodLead({ step_status: { render: { state: "done" } } }), p, { force: true });
    expect(p.markStep).toHaveBeenCalledWith("8442b5a1", "render",
      expect.objectContaining({ state: "done" }));
  });

  it("marks skipped with reason when the gate fails", async () => {
    const p = fakePersistence();
    await applyRender(goodLead({ tam: { tamEstimation: 0 } }), p);
    expect(p.markStep).toHaveBeenCalledWith("8442b5a1", "render",
      expect.objectContaining({ state: "skipped" }));
    expect(p.writeColumn).not.toHaveBeenCalled();
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("happy path writes both columns and marks done", async () => {
    const p = fakePersistence();
    await applyRender(goodLead(), p);
    expect(p.writeColumn).toHaveBeenCalledWith("8442b5a1", "rendered_html", expect.any(String));
    expect(p.writeColumn).toHaveBeenCalledWith("8442b5a1", "render",
      { pdfUrl: "https://store.example/8442b5a1.pdf", pageUrl: "https://sites.example/d/8442b5a1" });
    expect(p.markStep).toHaveBeenCalledWith("8442b5a1", "render",
      expect.objectContaining({ state: "done", provider: "self-hosted", cost_usd: 0 }));
  });

  it("writes the rendered PDF via writeArtifact", async () => {
    const p = fakePersistence();
    await applyRender(goodLead(), p);
    expect(p.writeArtifact).toHaveBeenCalledWith("8442b5a1", "pdf", expect.any(Buffer));
    expect(p.writeArtifact).toHaveBeenCalledWith("8442b5a1", "html", expect.any(Buffer));
  });

  it("interpolates the lead into rendered_html (no leftover [Company])", async () => {
    const p = fakePersistence();
    await applyRender(goodLead(), p);
    const calls = p.writeColumn.mock.calls as unknown as Array<[string, string, string]>;
    const htmlCall = calls.find((c) => c[1] === "rendered_html");
    expect(htmlCall?.[2]).toContain("Acme Inc");
    expect(htmlCall?.[2]).not.toContain("[Company]");
  });

  it("swallows an artifact-write error to a markStep error and writes NO columns", async () => {
    const p = fakePersistence();
    p.writeArtifact.mockRejectedValue(new Error("storage down"));
    await applyRender(goodLead(), p);
    expect(p.markStep).toHaveBeenCalledWith("8442b5a1", "render",
      expect.objectContaining({ state: "error" }));
    // No partial write: rendered_html is only persisted after a successful artifact write.
    expect(p.writeColumn).not.toHaveBeenCalled();
  });

  it("closes the browser even when pdf generation throws", async () => {
    const p = fakePersistence();
    pdfMock.mockRejectedValue(new Error("boom"));
    await applyRender(goodLead(), p);
    expect(closeMock).toHaveBeenCalled();
    expect(p.markStep).toHaveBeenCalledWith("8442b5a1", "render",
      expect.objectContaining({ state: "error" }));
  });
});
