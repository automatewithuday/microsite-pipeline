import { describe, expect, it } from "vitest";
import type { LeadRow } from "../db.js";
import { buildFollowupPlaceholders } from "./followupData.js";

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
    research: { response: "Acme sells widgets to mid-market retailers." },
    tam: { tamEstimation: 20000 },
    icp_segments: {
      segments: [
        {
          segmentName: "Mid-market retail",
          companyCharacteristic: "c",
          keyPainPoint: "k",
          primaryBuyer: "b",
          differentiatingNeed: "d",
        },
      ],
    },
    sales_signals: { signals: ["s1", "s2", "s3"] },
    ...overrides,
  };
}

describe("buildFollowupPlaceholders", () => {
  it("returns null when neither company name nor research is present", () => {
    expect(
      buildFollowupPlaceholders(makeLead({ company_data: {}, company: null, research: null }), "digest")
    ).toBeNull();
  });

  it("fills every placeholder from lead columns", () => {
    const p = buildFollowupPlaceholders(makeLead(), "THE-DIGEST")!;
    expect(p.company).toBe("Acme Inc");
    expect(p.domain).toBe("acme.com");
    expect(p.crm).toBe("HubSpot");
    expect(p.traffic).toContain("12345");
    expect(p.ads).toContain("Meta ads live: 40");
    expect(p.ads).toContain("Google ads live: 5");
    expect(p.ads).toContain("LinkedIn ads live: 0");
    expect(p.research).toContain("widgets");
    expect(p.tam).toContain("20000");
    expect(p.icp_segments).toContain("Mid-market retail");
    expect(p.sales_signals).toContain("s1");
    expect(p.library_digest).toBe("THE-DIGEST");
    expect(p.call_notes).toBe("");
    expect(p.steer).toBe("");
  });

  it("passes call notes and steer through when present", () => {
    const lead = makeLead({ call_notes: "They mentioned churn is the burning issue." });
    const p = buildFollowupPlaceholders(lead, "d", "Focus on retention angle")!;
    expect(p.call_notes).toContain("churn");
    expect(p.steer).toBe("Focus on retention angle");
  });

  it("degrades gracefully: missing optional columns become 'unknown'", () => {
    const p = buildFollowupPlaceholders(
      makeLead({
        traffic: null,
        ads_meta: null,
        ads_google: null,
        ads_linkedin: null,
        crm: null,
        tam: null,
        icp_segments: null,
        sales_signals: null,
      }),
      "d"
    )!;
    expect(p.traffic).toBe("unknown");
    expect(p.crm).toBe("unknown");
    expect(p.tam).toBe("unknown");
  });
});
