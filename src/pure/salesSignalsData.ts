// Gathers step 12's sales-signals prompt placeholders off a lead row. No
// I/O, no LLM calls.

export interface LeadLike {
  company?: unknown;
  company_data?: unknown;
  traffic?: unknown;
  ads_meta?: unknown;
  ads_google?: unknown;
  ads_linkedin?: unknown;
  crm?: unknown;
  sdr?: unknown;
  founders?: unknown;
  research?: unknown;
  // See derived.ts's DerivedLeadLike for why this index signature is
  // needed: it lets a LeadRow (index-signature-typed) satisfy this
  // all-optional interface under TS's weak-type-detection rule.
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const RESEARCH_TRUNCATE_LENGTH = 4000;

export interface SalesSignalsPlaceholders {
  Company: string;
  totalVisits: string;
  paidSearchVisits: string;
  metaAds: string;
  linkedinAds: string;
  googleAds: string;
  crmPlatform: string;
  sdrCount: string;
  numFollowers: string;
  research: string;
  // Every field above is already a string; the index signature just lets
  // this satisfy interpolatePrompt's `Record<string, string>` parameter
  // type without a cast.
  [key: string]: string;
}

/**
 * Returns null when the two hard requirements are missing: a company name
 * (needed to address the pitch) or a research response (the prompt's core
 * input). Every other field degrades gracefully:
 * traffic/follower counts missing -> "unknown" (the model is told this is
 * unknown data, never fabricates a number for it); ad counts and SDR count
 * missing -> 0 (the "missing = 0" convention, extended here since
 * an ad-library or SDR-search miss is a legitimate zero, not an unknown);
 * CRM missing -> "your CRM" (the standard fallback copy).
 */
export function buildSalesSignalsPlaceholders(lead: LeadLike): SalesSignalsPlaceholders | null {
  const merged = isRecord(lead.company_data) && isRecord(lead.company_data.merged)
    ? lead.company_data.merged
    : {};
  const companyName =
    typeof merged.name === "string" && merged.name.length > 0
      ? merged.name
      : typeof lead.company === "string"
        ? lead.company
        : null;

  const research = isRecord(lead.research) && typeof lead.research.response === "string"
    ? lead.research.response
    : null;

  if (!companyName || !research) return null;

  const traffic = isRecord(lead.traffic) ? lead.traffic : {};
  const totalVisits = typeof traffic.totalVisits === "number" ? traffic.totalVisits : null;
  const paidSearchVisits = typeof traffic.paidSearchVisits === "number" ? traffic.paidSearchVisits : null;

  const adsMeta = isRecord(lead.ads_meta) && typeof lead.ads_meta.count === "number" ? lead.ads_meta.count : 0;
  const adsGoogle =
    isRecord(lead.ads_google) && typeof lead.ads_google.count === "number" ? lead.ads_google.count : 0;
  const adsLinkedin =
    isRecord(lead.ads_linkedin) && typeof lead.ads_linkedin.count === "number" ? lead.ads_linkedin.count : 0;

  const crmPlatform =
    isRecord(lead.crm) && typeof lead.crm.platform === "string" && lead.crm.platform.length > 0
      ? lead.crm.platform
      : "your CRM";

  const sdrCount = isRecord(lead.sdr) && typeof lead.sdr.peopleCount === "number" ? lead.sdr.peopleCount : 0;

  const numFollowers =
    isRecord(lead.founders) && typeof lead.founders.num_followers === "number"
      ? lead.founders.num_followers
      : null;

  return {
    Company: companyName,
    totalVisits: totalVisits === null ? "unknown" : String(totalVisits),
    paidSearchVisits: paidSearchVisits === null ? "unknown" : String(paidSearchVisits),
    metaAds: String(adsMeta),
    linkedinAds: String(adsLinkedin),
    googleAds: String(adsGoogle),
    crmPlatform,
    sdrCount: String(sdrCount),
    numFollowers: numFollowers === null ? "unknown" : String(numFollowers),
    research: research.slice(0, RESEARCH_TRUNCATE_LENGTH),
  };
}
