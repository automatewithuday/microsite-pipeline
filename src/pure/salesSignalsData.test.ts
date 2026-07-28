import { describe, expect, it } from "vitest";
import { buildSalesSignalsPlaceholders, type LeadLike } from "./salesSignalsData.js";

function fullLead(): LeadLike {
  return {
    company: "Fallback Co",
    company_data: { merged: { name: "Acme Inc" } },
    traffic: { totalVisits: 12345, paidSearchVisits: 3086 },
    ads_meta: { count: 40 },
    ads_google: { count: 5 },
    ads_linkedin: { count: 0 },
    crm: { platform: "HubSpot" },
    sdr: { peopleCount: 2 },
    founders: { num_followers: 15000 },
    research: { response: "Acme sells widgets to mid-market retailers." },
  };
}

describe("buildSalesSignalsPlaceholders", () => {
  it("returns null when there is no company name at all", () => {
    expect(
      buildSalesSignalsPlaceholders({ research: { response: "x" } })
    ).toBe(null);
  });

  it("returns null when there is no research response", () => {
    expect(buildSalesSignalsPlaceholders({ company: "Acme" })).toBe(null);
  });

  it("prefers company_data.merged.name over the bare company field", () => {
    const result = buildSalesSignalsPlaceholders(fullLead());
    expect(result?.Company).toBe("Acme Inc");
  });

  it("falls back to the bare company field when merged.name is absent", () => {
    const lead = fullLead();
    lead.company_data = { merged: {} };
    const result = buildSalesSignalsPlaceholders(lead);
    expect(result?.Company).toBe("Fallback Co");
  });

  it("fills every field from a fully populated lead", () => {
    const result = buildSalesSignalsPlaceholders(fullLead());
    expect(result).toEqual({
      Company: "Acme Inc",
      totalVisits: "12345",
      paidSearchVisits: "3086",
      metaAds: "40",
      linkedinAds: "0",
      googleAds: "5",
      crmPlatform: "HubSpot",
      sdrCount: "2",
      numFollowers: "15000",
      research: "Acme sells widgets to mid-market retailers.",
    });
  });

  it("uses unknown for missing traffic and follower numbers, never 0", () => {
    const lead = fullLead();
    lead.traffic = {};
    lead.founders = {};
    const result = buildSalesSignalsPlaceholders(lead);
    expect(result?.totalVisits).toBe("unknown");
    expect(result?.paidSearchVisits).toBe("unknown");
    expect(result?.numFollowers).toBe("unknown");
  });

  it("uses 0 for missing ad counts and SDR count", () => {
    const lead = fullLead();
    lead.ads_meta = {};
    lead.ads_google = {};
    lead.ads_linkedin = {};
    lead.sdr = {};
    const result = buildSalesSignalsPlaceholders(lead);
    expect(result?.metaAds).toBe("0");
    expect(result?.linkedinAds).toBe("0");
    expect(result?.googleAds).toBe("0");
    expect(result?.sdrCount).toBe("0");
  });

  it("falls back to 'your CRM' when crm.platform is null", () => {
    const lead = fullLead();
    lead.crm = { platform: null };
    const result = buildSalesSignalsPlaceholders(lead);
    expect(result?.crmPlatform).toBe("your CRM");
  });

  it("truncates research to 4000 chars", () => {
    const lead = fullLead();
    lead.research = { response: "x".repeat(5000) };
    const result = buildSalesSignalsPlaceholders(lead);
    expect(result?.research).toHaveLength(4000);
  });
});
