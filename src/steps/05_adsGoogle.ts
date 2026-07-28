// Step 05 (Google): ads_google. Apify Google Ads Transparency actor
// (parseforge/google-ads-scraper, live-verified 2026-07-24). The actor's
// `domain` search returns one item per ad creative pointing at the domain
// (mirrors Google's own "N ads" domain view), so count = number of items.
// maxItems caps cost: $5/1000 results, cap 100 => <= $0.50/lead. region:""
// means anywhere. "Missing = 0": an unset actor env, no
// domain, or an empty result set is a done step with count 0, never a skip or
// an error (only a genuine thrown transport error after retries is a step
// error).

import { APIFY_ACTOR_GOOGLE_ADS, APIFY_TOKEN, type LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { extractGoogleAdCount } from "../pure/adsExtract.js";
import { runActor } from "../providers/apify.js";

const MAX_ITEMS = 100;

async function run(lead: LeadRow): Promise<StepResult> {
  const companyData = lead.company_data as { merged?: { domain?: unknown } } | null | undefined;
  const domain = typeof companyData?.merged?.domain === "string" ? companyData.merged.domain : null;

  if (!APIFY_TOKEN || !APIFY_ACTOR_GOOGLE_ADS || !domain) {
    return { data: { count: 0, raw: [] }, cost_usd: 0, provider: "apify:google_ads" };
  }

  const { items, runCost_usd } = await runActor(
    APIFY_ACTOR_GOOGLE_ADS,
    { domain, maxItems: MAX_ITEMS, region: "" },
    { timeoutMs: 100_000 }
  );

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
