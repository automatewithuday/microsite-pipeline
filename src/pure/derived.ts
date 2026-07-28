// Derived formulas pass (the `derived` column). Wires
// the pure functions in formulas.ts and adSummary.ts against the stored
// step outputs on a lead row to produce the `qualified` boolean and
// `derived` JSONB the render gate reads. No I/O, no LLM calls;
// this is deterministic.

import { adSummary } from "./adSummary.js";
import {
  adjustedTam,
  adjustedTam2,
  liFollowersInsight,
  paidSearchPct,
  qualified,
  sdrInsight,
} from "./formulas.js";

export interface DerivedLeadLike {
  company_data?: unknown;
  traffic?: unknown;
  founders?: unknown;
  sdr?: unknown;
  crm?: unknown;
  ads_meta?: unknown;
  ads_google?: unknown;
  ads_linkedin?: unknown;
  tam?: unknown;
  // Index signature so LeadRow (which has its own `[key: string]: unknown`
  // rather than these named properties) satisfies this type: without it,
  // TS's weak-type-detection heuristic sees no property names in common
  // between LeadRow and an all-optional interface and rejects the
  // assignment even though every value would be structurally fine.
  [key: string]: unknown;
}

export interface Derived {
  paidSearchPct: string | null;
  liFollowersInsight: string | null;
  sdrInsight: string;
  crmPlatform: string;
  adSummary: string;
  adjustedTam: number | null;
  adjustedTam2: number | null;
}

export interface DerivedResult {
  qualified: boolean;
  derived: Derived;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Computes `qualified` and every field of `derived` off a lead row's
 * already-stored step outputs. Every input is optional/nullable: a step
 * that never ran, was skipped, or errored simply leaves its slice of
 * `derived` null (paidSearchPct, liFollowersInsight, adjustedTam,
 * adjustedTam2) or falling back to its documented default (sdrInsight and
 * adSummary treat a missing count as 0, a legitimate "no activity" result
 * per the "missing = 0" rule; crmPlatform falls back to "your CRM"
 * per the deck's page-6 fallback copy). Nothing here fabricates a
 * number that wasn't actually observed.
 */
export function computeDerived(lead: DerivedLeadLike): DerivedResult {
  const merged =
    isRecord(lead.company_data) && isRecord(lead.company_data.merged) ? lead.company_data.merged : {};
  const employeeCountRaw = merged.employee_count;
  const employeeCount =
    typeof employeeCountRaw === "number"
      ? employeeCountRaw
      : typeof employeeCountRaw === "string" && employeeCountRaw.trim() !== ""
        ? Number(employeeCountRaw)
        : NaN;
  const industry = typeof merged.industry === "string" ? merged.industry : null;
  const isQualified = Number.isFinite(employeeCount) && qualified(employeeCount, industry);

  const traffic = isRecord(lead.traffic) ? lead.traffic : {};
  const totalVisits = readNumber(traffic, "totalVisits");
  const paidSearchVisits = readNumber(traffic, "paidSearchVisits");
  const paidSearchPctValue =
    totalVisits === null ? null : paidSearchPct(totalVisits, paidSearchVisits ?? 0);

  const founders = isRecord(lead.founders) ? lead.founders : {};
  const founderName = typeof founders.first_name === "string" ? founders.first_name : null;
  const numFollowers = readNumber(founders, "num_followers");
  const liFollowersInsightValue =
    founderName !== null && numFollowers !== null ? liFollowersInsight(founderName, numFollowers) : null;

  const sdr = isRecord(lead.sdr) ? lead.sdr : {};
  const sdrCount = readNumber(sdr, "peopleCount") ?? 0;
  const sdrInsightValue = sdrInsight(sdrCount);

  const crm = isRecord(lead.crm) ? lead.crm : {};
  const crmPlatform = typeof crm.platform === "string" && crm.platform.length > 0 ? crm.platform : "your CRM";

  const adsMeta = isRecord(lead.ads_meta) ? readNumber(lead.ads_meta, "count") ?? 0 : 0;
  const adsGoogle = isRecord(lead.ads_google) ? readNumber(lead.ads_google, "count") ?? 0 : 0;
  const adsLinkedin = isRecord(lead.ads_linkedin) ? readNumber(lead.ads_linkedin, "count") ?? 0 : 0;
  const adSummaryValue = adSummary(adsMeta, adsLinkedin, adsGoogle);

  const tam = isRecord(lead.tam) ? lead.tam : {};
  const tamEstimation = readNumber(tam, "tamEstimation");
  const tamRealistic = readNumber(tam, "tamRealistic");
  const tamConservative = readNumber(tam, "tamConservative");
  // Deck funnel tiers 2 and 3. Prefer the research's own Realistic/Conservative
  // scenario counts (step 10 stores them when the research sizes three scenarios);
  // fall back to the adjustedTam/adjustedTam2 multipliers when only a single TAM
  // number came back. Clamp so the funnel is always non-increasing
  // (tier1 >= tier2 >= tier3) regardless of how the model ordered the scenarios.
  const adjustedTamValue =
    tamEstimation === null
      ? null
      : Math.min(tamRealistic ?? adjustedTam(tamEstimation), tamEstimation);
  const adjustedTam2Value =
    tamEstimation === null
      ? null
      : Math.min(tamConservative ?? adjustedTam2(tamEstimation), adjustedTamValue ?? tamEstimation);

  return {
    qualified: isQualified,
    derived: {
      paidSearchPct: paidSearchPctValue,
      liFollowersInsight: liFollowersInsightValue,
      sdrInsight: sdrInsightValue,
      crmPlatform,
      adSummary: adSummaryValue,
      adjustedTam: adjustedTamValue,
      adjustedTam2: adjustedTam2Value,
    },
  };
}
