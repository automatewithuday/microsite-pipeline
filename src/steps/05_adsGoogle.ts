// Step 05 (Google): ads_google. Apify Google Ads Transparency actor
// (parseforge/google-ads-scraper, live-verified 2026-07-24). The actor's
// `domain` search returns one item per ad creative pointing at the domain
// (mirrors Google's own "N ads" domain view), so count = number of items.
// maxItems caps cost: $5/1000 results, cap 100 => <= $0.50/lead. region:""
// means anywhere. "Missing = 0": an unset actor env, no
// domain, or an empty result set is a done step with count 0, never a skip or
// an error (only a genuine thrown transport error after retries is a step
// error).

import {
  ADS_TRAFFIC_PROVIDER,
  APIFY_ACTOR_GOOGLE_ADS,
  APIFY_TOKEN,
  DEEPLINE_API_KEY,
  type LeadRow,
} from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { extractGoogleAdCount } from "../pure/adsExtract.js";
import { runActor } from "../providers/apify.js";
import { runAdyntelFallback } from "./05_adsShared.js";

const MAX_ITEMS = 100;

async function run(lead: LeadRow): Promise<StepResult> {
  const companyData = lead.company_data as { merged?: { domain?: unknown } } | null | undefined;
  const domain = typeof companyData?.merged?.domain === "string" ? companyData.merged.domain : null;

  // Explicit route: "deepline" never touches Apify; "apify" never touches
  // Deepline; "auto" (default) prefers Apify with the Deepline fallback.
  if (ADS_TRAFFIC_PROVIDER === "deepline") {
    if (DEEPLINE_API_KEY && domain) return runAdyntelFallback("adyntel_google", domain);
    return { data: { count: 0, raw: [] }, cost_usd: 0, provider: "deepline:adyntel_google" };
  }
  const deeplineFallback = ADS_TRAFFIC_PROVIDER === "auto" && DEEPLINE_API_KEY;

  if (!APIFY_TOKEN || !APIFY_ACTOR_GOOGLE_ADS || !domain) {
    if (deeplineFallback && domain) return runAdyntelFallback("adyntel_google", domain);
    return { data: { count: 0, raw: [] }, cost_usd: 0, provider: "apify:google_ads" };
  }

  let items: unknown[];
  let runCost_usd: number | null;
  try {
    ({ items, runCost_usd } = await runActor(
      APIFY_ACTOR_GOOGLE_ADS,
      { domain, maxItems: MAX_ITEMS, region: "" },
      { timeoutMs: 100_000 }
    ));
  } catch (err) {
    // Apify unavailable (e.g. monthly usage hard limit): Adyntel via Deepline.
    if (deeplineFallback) return runAdyntelFallback("adyntel_google", domain);
    throw err;
  }

  const data: Record<string, unknown> = { count: extractGoogleAdCount(items), raw: items };
  if (runCost_usd === null) data.cost_unknown = true;

  return { data, cost_usd: runCost_usd ?? 0, provider: "apify:google_ads" };
}

const step: StepModule = {
  name: "ads_google",
  column: "ads_google",
  dependsOn: ["company"],
  run,
};

export default step;
