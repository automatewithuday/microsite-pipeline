import { describe, expect, it } from "vitest";
import { computeDerived, type DerivedLeadLike } from "./derived.js";

function fullLead(): DerivedLeadLike {
  return {
    company_data: { merged: { employee_count: 50, industry: "Software Development" } },
    traffic: { totalVisits: 12345, paidSearchVisits: 3086 },
    founders: { first_name: "Jamie", num_followers: 15000 },
    sdr: { peopleCount: 2 },
    crm: { platform: "HubSpot" },
    ads_meta: { count: 40 },
    ads_google: { count: 5 },
    ads_linkedin: { count: 0 },
    tam: { tamEstimation: 10000 },
  };
}

describe("computeDerived", () => {
  it("computes every field from a fully populated lead", () => {
    const result = computeDerived(fullLead());
    expect(result.qualified).toBe(true);
    expect(result.derived).toEqual({
      paidSearchPct: "Around 12,345 monthly visits, 25% coming from paid",
      liFollowersInsight:
        "Jamie has 15,000 LinkedIn followers, so LinkedIn social is probably a significant channel.",
      sdrInsight: "With a SDR team of 2, the outbound motion could have some room to grow.",
      crmPlatform: "HubSpot",
      adSummary: "You run a lot of Meta ads with 40 having been tested.",
      adjustedTam: 9000,
      adjustedTam2: 6000,
    });
  });

  it("is not qualified when employee count is outside 11-200", () => {
    const lead = { ...fullLead(), company_data: { merged: { employee_count: 5, industry: "Software" } } };
    expect(computeDerived(lead).qualified).toBe(false);
  });

  it("is not qualified when industry is not software", () => {
    const lead = { ...fullLead(), company_data: { merged: { employee_count: 50, industry: "Fintech" } } };
    expect(computeDerived(lead).qualified).toBe(false);
  });

  it("is not qualified when employee_count is missing", () => {
    const result = computeDerived({ company_data: { merged: { industry: "Software" } } });
    expect(result.qualified).toBe(false);
  });

  it("coerces a string employee_count", () => {
    const lead = { ...fullLead(), company_data: { merged: { employee_count: "50", industry: "Software" } } };
    expect(computeDerived(lead).qualified).toBe(true);
  });

  it("paidSearchPct is null when traffic never ran (no totalVisits)", () => {
    const lead = { ...fullLead(), traffic: {} };
    expect(computeDerived(lead).derived.paidSearchPct).toBe(null);
  });

  it("liFollowersInsight is null when founders has no num_followers", () => {
    const lead = { ...fullLead(), founders: { first_name: "Jamie" } };
    expect(computeDerived(lead).derived.liFollowersInsight).toBe(null);
  });

  it("liFollowersInsight is null when founders is entirely missing", () => {
    const lead = { ...fullLead(), founders: undefined };
    expect(computeDerived(lead).derived.liFollowersInsight).toBe(null);
  });

  it("sdrInsight treats a missing SDR count as 0, not null", () => {
    const lead = { ...fullLead(), sdr: {} };
    expect(computeDerived(lead).derived.sdrInsight).toBe(
      "With no SDRs/BDRs, the outbound motion has a lot of room for development."
    );
  });

  it("crmPlatform falls back to 'your CRM' when crm.platform is null", () => {
    const lead = { ...fullLead(), crm: { platform: null } };
    expect(computeDerived(lead).derived.crmPlatform).toBe("your CRM");
  });

  it("adSummary treats missing ad counts as 0", () => {
    const lead = { ...fullLead(), ads_meta: {}, ads_google: {}, ads_linkedin: {} };
    expect(computeDerived(lead).derived.adSummary).toBe("No significant ad activity detected.");
  });

  it("adjustedTam/adjustedTam2 are null when tam never landed", () => {
    const lead = { ...fullLead(), tam: undefined };
    const result = computeDerived(lead);
    expect(result.derived.adjustedTam).toBe(null);
    expect(result.derived.adjustedTam2).toBe(null);
  });

  it("funnel tiers use the research scenario counts when present, not the multipliers", () => {
    const lead = {
      ...fullLead(),
      tam: { tamEstimation: 33200, tamRealistic: 17000, tamConservative: 8294 },
    };
    const result = computeDerived(lead);
    // Optimistic / Realistic / Conservative straight through, not 33200*0.9/0.6.
    expect(result.derived.adjustedTam).toBe(17000);
    expect(result.derived.adjustedTam2).toBe(8294);
  });

  it("falls back to the multipliers when scenario counts are null", () => {
    const lead = {
      ...fullLead(),
      tam: { tamEstimation: 10000, tamRealistic: null, tamConservative: null },
    };
    const result = computeDerived(lead);
    expect(result.derived.adjustedTam).toBe(9000);
    expect(result.derived.adjustedTam2).toBe(6000);
  });

  it("clamps the funnel to non-increasing when scenarios are mis-ordered", () => {
    const lead = {
      ...fullLead(),
      // Realistic above Optimistic, Conservative above Realistic: clamp both down.
      tam: { tamEstimation: 20000, tamRealistic: 25000, tamConservative: 22000 },
    };
    const result = computeDerived(lead);
    expect(result.derived.adjustedTam).toBe(20000); // min(25000, 20000)
    expect(result.derived.adjustedTam2).toBe(20000); // min(22000, 20000)
  });

  it("handles a lead with no step outputs at all without throwing", () => {
    const result = computeDerived({});
    expect(result.qualified).toBe(false);
    expect(result.derived.paidSearchPct).toBe(null);
    expect(result.derived.liFollowersInsight).toBe(null);
    expect(result.derived.crmPlatform).toBe("your CRM");
    expect(result.derived.adSummary).toBe("No significant ad activity detected.");
    expect(result.derived.adjustedTam).toBe(null);
  });
});
