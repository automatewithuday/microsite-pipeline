// Step 05 (Meta): ads_meta. Apify Meta Ad Library actor
// (apify/facebook-ads-scraper, live-verified 2026-07-24). Meta's Ad Library is
// keyed by advertiser Page, not by website domain, so we run a country=ALL
// keyword search on the enriched company NAME and then count only the ads from
// the company's own Page(s), identified by DESTINATION DOMAIN (extractMetaAdCount
// ignores the unrelated advertisers the keyword surfaces). resultsLimit caps cost:
// $3.40/1000 ads, cap 100 => <= $0.34/lead. "Missing = 0":
// no APIFY_TOKEN, an unset actor env, no company name, or an empty result set
// is a done step with count 0, never a skip or an error.
//
// The token check matters because .env.example ships a default actor id: without
// it a keyless run would call Apify unauthenticated, block on the paywall until
// the step times out, and land in "error" — which blocks sales_signals and
// costs the lead its deck.

import {
  ADS_TRAFFIC_PROVIDER,
  APIFY_ACTOR_META_ADS,
  APIFY_TOKEN,
  DEEPLINE_API_KEY,
  type LeadRow,
} from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { extractMetaAdCount } from "../pure/adsExtract.js";
import { runActor } from "../providers/apify.js";
import { runAdyntelFallback } from "./05_adsShared.js";

const RESULTS_LIMIT = 100;

function adLibrarySearchUrl(companyName: string): string {
  const q = encodeURIComponent(companyName);
  return (
    "https://www.facebook.com/ads/library/?active_status=active&ad_type=all" +
    `&country=ALL&q=${q}&search_type=keyword_unordered`
  );
}

async function run(lead: LeadRow): Promise<StepResult> {
  const companyData = lead.company_data as { merged?: { name?: unknown; domain?: unknown } } | null | undefined;
  const name = typeof companyData?.merged?.name === "string" ? companyData.merged.name.trim() : "";
  const domain = typeof companyData?.merged?.domain === "string" ? companyData.merged.domain : null;

  // Explicit route: "deepline" never touches Apify; "apify" never touches
  // Deepline; "auto" (default) prefers Apify with the Deepline fallback.
  if (ADS_TRAFFIC_PROVIDER === "deepline") {
    if (DEEPLINE_API_KEY && domain) return runAdyntelFallback("adyntel_facebook", domain);
    return { data: { count: 0, raw: [] }, cost_usd: 0, provider: "deepline:adyntel_facebook" };
  }
  const deeplineFallback = ADS_TRAFFIC_PROVIDER === "auto" && DEEPLINE_API_KEY;

  if (!APIFY_TOKEN || !APIFY_ACTOR_META_ADS || !name) {
    if (deeplineFallback && domain) return runAdyntelFallback("adyntel_facebook", domain);
    return { data: { count: 0, raw: [] }, cost_usd: 0, provider: "apify:meta_ads" };
  }

  let items: unknown[];
  let runCost_usd: number | null;
  try {
    ({ items, runCost_usd } = await runActor(
      APIFY_ACTOR_META_ADS,
      { startUrls: [{ url: adLibrarySearchUrl(name) }], resultsLimit: RESULTS_LIMIT },
      { timeoutMs: 100_000 }
    ));
  } catch (err) {
    // Apify unavailable (e.g. monthly usage hard limit): Adyntel via Deepline.
    if (deeplineFallback && domain) return runAdyntelFallback("adyntel_facebook", domain);
    throw err;
  }

  const data: Record<string, unknown> = { count: extractMetaAdCount(items, domain, name), raw: items };
  if (runCost_usd === null) data.cost_unknown = true;

  return { data, cost_usd: runCost_usd ?? 0, provider: "apify:meta_ads" };
}

const step: StepModule = {
  name: "ads_meta",
  column: "ads_meta",
  dependsOn: ["company"],
  run,
};

export default step;
