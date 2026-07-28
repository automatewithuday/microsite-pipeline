// Step 05 (LinkedIn): ads_linkedin. Apify LinkedIn Ad Library actor
// (ivanvs/linkedin-ad-library-scraper, pay-per-record; swapped 2026-07-27 from
// s-r/linkedin-ads-library, which capped at ~24 ads/page with no pagination so
// EVERY company reported exactly 24). This actor paginates: we feed it an
// ?accountOwner= Ad Library search URL and a maxRecords cap, getting one item
// per ad (advertiser is an object {name,url}). The account-owner search is
// still fuzzy, so extractLinkedInAdCount filters to the company's OWN ads by
// advertiser name, never counting collision advertisers. "Missing = 0"
// applies. MAX_LINKEDIN_ADS caps cost: below it the count is exact, at it
// the count is a floor (a heavy advertiser reads "N+"). Pay-per-record means a
// light advertiser stays cheap regardless of the cap.

import { APIFY_ACTOR_LINKEDIN_ADS, APIFY_TOKEN, type LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { extractLinkedInAdCount } from "../pure/adsExtract.js";
import { runActor } from "../providers/apify.js";

// Per-lead ad cap. Pay-per-record, so this bounds cost for unusually heavy
// advertisers (e.g. cal.com runs 100+ LinkedIn ads); typical companies run far
// fewer and return their exact count well under it. Tune freely.
const MAX_LINKEDIN_ADS = 100;

async function run(lead: LeadRow): Promise<StepResult> {
  const companyData = lead.company_data as { merged?: { name?: unknown } } | null | undefined;
  const companyName = typeof companyData?.merged?.name === "string" ? companyData.merged.name : null;

  if (!APIFY_TOKEN || !APIFY_ACTOR_LINKEDIN_ADS || !companyName) {
    return { data: { count: 0, raw: [] }, cost_usd: 0, provider: "apify:linkedin_ads" };
  }

  // Account-scoped Ad Library search URL (fuzzy on LinkedIn's side; the
  // extractor filters to the company's own advertiser).
  const url = `https://www.linkedin.com/ad-library/search?accountOwner=${encodeURIComponent(companyName)}`;
  const { items, runCost_usd } = await runActor(
    APIFY_ACTOR_LINKEDIN_ADS,
    { urls: [{ url }], maxRecords: MAX_LINKEDIN_ADS },
    { timeoutMs: 180_000 }
  );

  const data: Record<string, unknown> = { count: extractLinkedInAdCount(items, companyName), raw: items };
  if (runCost_usd === null) data.cost_unknown = true;

  return { data, cost_usd: runCost_usd ?? 0, provider: "apify:linkedin_ads" };
}

const step: StepModule = {
  name: "ads_linkedin",
  column: "ads_linkedin",
  dependsOn: ["company"],
  run,
};

export default step;
