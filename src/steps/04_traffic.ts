// Step 04: traffic. Apify SimilarWeb actor (vortex_data/similarweb-scraper,
// base_data mode, docs-derived shape).

import { APIFY_ACTOR_SIMILARWEB, APIFY_TOKEN, type LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { extractTraffic } from "../pure/trafficExtract.js";
import { runActor } from "../providers/apify.js";

async function run(lead: LeadRow): Promise<StepResult> {
  const companyData = lead.company_data as { merged?: { domain?: unknown } } | null | undefined;
  const domain = typeof companyData?.merged?.domain === "string" ? companyData.merged.domain : null;

  if (!domain) {
    return { skipped: "company domain is null" };
  }

  // Without a token the actor call would block on Apify's paywall until the
  // step timed out, so treat it the same as an unconfigured actor.
  if (!APIFY_TOKEN) {
    return { skipped: "APIFY_TOKEN not configured" };
  }

  if (!APIFY_ACTOR_SIMILARWEB) {
    return { skipped: "APIFY_ACTOR_SIMILARWEB not configured" };
  }

  const { items, runCost_usd } = await runActor(
    APIFY_ACTOR_SIMILARWEB,
    { domains: [domain], datasetMode: "base_data" },
    { timeoutMs: 100_000 }
  );

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
