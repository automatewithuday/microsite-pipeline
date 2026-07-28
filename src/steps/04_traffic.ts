// Step 04: traffic. Apify SimilarWeb actor (vortex_data/similarweb-scraper,
// base_data mode, docs-derived shape). Falls back to Deepline's DataForSEO
// Labs domain-rank-overview tool when Apify is unconfigured or fails (e.g.
// monthly usage hard limit). The fallback's numbers are estimated monthly
// GOOGLE SEARCH traffic (organic + paid etv), not SimilarWeb total site
// visits; source_field="dataforseo_etv" records the difference.

import {
  ADS_TRAFFIC_PROVIDER,
  APIFY_ACTOR_SIMILARWEB,
  APIFY_TOKEN,
  DEEPLINE_API_KEY,
  type LeadRow,
} from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { extractDataforseoTraffic } from "../pure/adyntelExtract.js";
import { extractCostAndProvider } from "../pure/deeplineMeta.js";
import { extractTraffic } from "../pure/trafficExtract.js";
import { runActor } from "../providers/apify.js";
import { executeTool } from "../providers/deepline.js";

const DATAFORSEO_TOOL = "dataforseo_dataforseo_labs_google_domain_rank_overview_live";
const US_LOCATION_CODE = 2840; // DataForSEO requires a market; US is the pipeline's primary ICP geography.

async function runDataforseoFallback(domain: string): Promise<StepResult> {
  const envelope = await executeTool(
    DATAFORSEO_TOOL,
    { target: domain, location_code: US_LOCATION_CODE, language_code: "en" },
    100_000
  );
  const raw = (envelope as { toolResponse?: { raw?: unknown } } | null | undefined)?.toolResponse?.raw;
  const extracted = extractDataforseoTraffic(raw);
  if (!extracted) {
    return { skipped: "no dataforseo data" };
  }
  const { cost_usd } = extractCostAndProvider(envelope, "deepline:dataforseo");
  return { data: { ...extracted, raw: envelope }, cost_usd, provider: "deepline:dataforseo" };
}

async function run(lead: LeadRow): Promise<StepResult> {
  const companyData = lead.company_data as { merged?: { domain?: unknown } } | null | undefined;
  const domain = typeof companyData?.merged?.domain === "string" ? companyData.merged.domain : null;

  if (!domain) {
    return { skipped: "company domain is null" };
  }

  // Explicit route: ADS_TRAFFIC_PROVIDER=deepline never touches Apify;
  // "apify" never touches Deepline; "auto" (default) prefers Apify with the
  // Deepline tools as fallback.
  if (ADS_TRAFFIC_PROVIDER === "deepline") {
    if (!DEEPLINE_API_KEY) {
      return { skipped: "ADS_TRAFFIC_PROVIDER=deepline but DEEPLINE_API_KEY not configured" };
    }
    return runDataforseoFallback(domain);
  }
  const deeplineFallback = ADS_TRAFFIC_PROVIDER === "auto" && DEEPLINE_API_KEY;

  // Without a token the actor call would block on Apify's paywall until the
  // step timed out, so treat it the same as an unconfigured actor.
  if (!APIFY_TOKEN) {
    if (deeplineFallback) return runDataforseoFallback(domain);
    return { skipped: "APIFY_TOKEN not configured" };
  }

  if (!APIFY_ACTOR_SIMILARWEB) {
    if (deeplineFallback) return runDataforseoFallback(domain);
    return { skipped: "APIFY_ACTOR_SIMILARWEB not configured" };
  }

  let items: unknown[];
  let runCost_usd: number | null;
  try {
    ({ items, runCost_usd } = await runActor(
      APIFY_ACTOR_SIMILARWEB,
      { domains: [domain], datasetMode: "base_data" },
      { timeoutMs: 100_000 }
    ));
  } catch (err) {
    // Apify unavailable (e.g. monthly usage hard limit): DataForSEO via Deepline.
    if (deeplineFallback) return runDataforseoFallback(domain);
    throw err;
  }

  const extracted = extractTraffic(items);
  if (!extracted) {
    return { skipped: "no similarweb data" };
  }

  const data: Record<string, unknown> = { ...extracted, raw: items };
  if (runCost_usd === null) data.cost_unknown = true;

  return { data, cost_usd: runCost_usd ?? 0, provider: "apify:similarweb" };
}

const step: StepModule = {
  name: "traffic",
  column: "traffic",
  dependsOn: ["company"],
  run,
};

export default step;
