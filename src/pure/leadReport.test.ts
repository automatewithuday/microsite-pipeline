import { describe, expect, it } from "vitest";
import type { LeadRow } from "../db.js";
import { buildLeadReport, extractResearchResponse } from "./leadReport.js";

function fullLead(): LeadRow {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    linkedin_url: "https://linkedin.com/in/jamie",
    company: "smartlead.ai",
    qualified: true,
    step_status: {
      company: { state: "done", at: "2026-07-28T10:00:00Z", cost_usd: 0.02, provider: "deepline" },
      traffic: { state: "done", at: "2026-07-28T10:01:00Z", cost_usd: 0.05, provider: "apify:similarweb" },
      research: { state: "done", at: "2026-07-28T10:05:00Z", cost_usd: 0.31, provider: "anthropic" },
      sdr: { state: "skipped", at: "2026-07-28T10:02:00Z" },
      render: { state: "error", at: "2026-07-28T10:09:00Z", error: "Chromium missing" },
    },
    company_data: {
      merged: {
        name: "SmartLead",
        domain: "smartlead.ai",
        website: "https://smartlead.ai",
        industry: "Software Development",
        employee_count: 120,
        description: "Cold email at scale.",
        linkedin_url: "https://linkedin.com/company/smartlead",
      },
      raw: { secret_blob: "RAW_COMPANY_PAYLOAD" },
    },
    traffic: { totalVisits: 12345, paidSearchVisits: 3086, raw: ["RAW_TRAFFIC_PAYLOAD"] },
    founders: {
      first_name: "Jamie",
      num_followers: 15000,
      founders_raw: { blob: "RAW_FOUNDERS_PAYLOAD" },
      enrich_raw: { blob: "RAW_ENRICH_PAYLOAD" },
    },
    sdr: { peopleCount: 2, raw: { blob: "RAW_SDR_PAYLOAD" } },
    crm: { platform: "HubSpot", method: "signatures", page: "homepage" },
    ads_meta: { count: 40 },
    ads_google: { count: 5 },
    ads_linkedin: { count: 0 },
    brand_colors: { primary: "#ff5500", secondary: "#001122", raw: { html: "RAW_BRAND_HTML" } },
    logo: { url: "https://cdn.brandfetch.io/smartlead.png" },
    research: { response: "FULL RESEARCH REPORT TEXT", provider: "anthropic", raw: "RAW_RESEARCH_PAYLOAD" },
    tam: { tamEstimation: 10000, tamRealistic: 7000, tamConservative: 4000, raw: "RAW_TAM_PAYLOAD" },
    icp_segments: {
      segments: [
        {
          segmentName: "Growth-Stage B2B SaaS",
          companyCharacteristic: "50-500 employees with outbound teams",
          keyPainPoint: "Low reply rates from generic sequences",
          primaryBuyer: "VP of Sales",
          differentiatingNeed: "Deliverability infrastructure at scale",
        },
        {
          segmentName: "Lead Gen Agencies",
          companyCharacteristic: "5-50 person agencies managing client outbound",
          keyPainPoint: "Managing dozens of client inboxes manually",
          primaryBuyer: "Agency founder",
          differentiatingNeed: "White-label multi-client workspaces",
        },
        {
          segmentName: "Recruiting Firms",
          companyCharacteristic: "Staffing firms doing candidate outreach",
          keyPainPoint: "Candidate emails landing in spam",
          primaryBuyer: "Managing Director",
          differentiatingNeed: "Volume sending without domain burn",
        },
      ],
    },
    sales_signals: {
      signals: ["Signal one about ads.", "Signal two about SDR gap.", "Signal three about CRM."],
    },
    derived: {
      paidSearchPct: "Around 12,345 monthly visits, 25% coming from paid",
      liFollowersInsight: "Jamie has 15,000 LinkedIn followers.",
      sdrInsight: "With a SDR team of 2, room to grow.",
      crmPlatform: "HubSpot",
      adSummary: "You run a lot of Meta ads with 40 having been tested.",
      adjustedTam: 7000,
      adjustedTam2: 4000,
    },
    render: { pageUrl: "file:///output/lead.html" },
  };
}

describe("buildLeadReport", () => {
  it("includes all five fields for every ICP segment, beyond the two the deck shows", () => {
    const report = buildLeadReport(fullLead());
    expect(report).toContain("Growth-Stage B2B SaaS");
    expect(report).toContain("Lead Gen Agencies");
    expect(report).toContain("Recruiting Firms");
    expect(report).toContain("Volume sending without domain burn");
    expect(report).toContain("Managing Director");
    expect(report).toContain("Candidate emails landing in spam");
    expect(report).toContain("Staffing firms doing candidate outreach");
  });

  it("includes the TAM scenarios, funnel values, and all three sales signals", () => {
    const report = buildLeadReport(fullLead());
    expect(report).toContain("10,000");
    expect(report).toContain("7,000");
    expect(report).toContain("4,000");
    expect(report).toContain("Signal one about ads.");
    expect(report).toContain("Signal two about SDR gap.");
    expect(report).toContain("Signal three about CRM.");
  });

  it("includes company enrichment, traffic, founders, ads, sdr, crm, and brand fields", () => {
    const report = buildLeadReport(fullLead());
    expect(report).toContain("SmartLead");
    expect(report).toContain("Software Development");
    expect(report).toContain("120");
    expect(report).toContain("12,345");
    expect(report).toContain("Jamie");
    expect(report).toContain("15,000");
    expect(report).toContain("HubSpot");
    expect(report).toContain("#ff5500");
    expect(report).toContain("You run a lot of Meta ads with 40 having been tested.");
  });

  it("includes a step status line per step with state, provider, cost, and error", () => {
    const report = buildLeadReport(fullLead());
    expect(report).toContain("apify:similarweb");
    expect(report).toContain("skipped");
    expect(report).toContain("Chromium missing");
    expect(report).toContain("$0.31");
  });

  it("never leaks raw payloads into the report", () => {
    const report = buildLeadReport(fullLead());
    expect(report).not.toContain("RAW_COMPANY_PAYLOAD");
    expect(report).not.toContain("RAW_TRAFFIC_PAYLOAD");
    expect(report).not.toContain("RAW_FOUNDERS_PAYLOAD");
    expect(report).not.toContain("RAW_ENRICH_PAYLOAD");
    expect(report).not.toContain("RAW_SDR_PAYLOAD");
    expect(report).not.toContain("RAW_BRAND_HTML");
    expect(report).not.toContain("RAW_RESEARCH_PAYLOAD");
    expect(report).not.toContain("RAW_TAM_PAYLOAD");
  });

  it("points at the research export instead of inlining the full report text", () => {
    const report = buildLeadReport(fullLead());
    expect(report).not.toContain("FULL RESEARCH REPORT TEXT");
    expect(report).toContain("research.md");
  });

  it("does not throw on a bare lead and marks unrun steps as not available", () => {
    const bare: LeadRow = { id: "id-1", step_status: null };
    const report = buildLeadReport(bare);
    expect(report).toContain("id-1");
    expect(report).toContain("not available");
  });
});

describe("extractResearchResponse", () => {
  it("returns the stored research response text", () => {
    expect(extractResearchResponse(fullLead())).toBe("FULL RESEARCH REPORT TEXT");
  });

  it("returns null when research has not run", () => {
    expect(extractResearchResponse({ id: "id-1", step_status: null })).toBeNull();
  });
});
