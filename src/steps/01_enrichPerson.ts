// Step 01: enrich person via the Deepline waterfall: BYOK
// Prospeo first, Apollo (free through Deepline) second, Deepline-native
// enrich_contact last. Each tier is attempted only when the previous one
// missed or errored; the first hit wins and its full envelope is stored.
// Provider misses are free on every tier (per_result / per matched contact
// pricing, confirmed via the billing ledger).

import { DEEPLINE_API_KEY, type LeadRow } from "../db.js";
import { NonRetryableError, type StepModule, type StepResult } from "../pipeline.js";
import { RateLimitError } from "../providerCooldown.js";
import { executeTool, PERSON_WATERFALL, type PersonEnrichInput } from "../providers/deepline.js";
import { deeplineFoundResult, extractCostAndProvider } from "../pure/deeplineMeta.js";

// Loose "this looks like a bare domain" check for the lead.company column,
// which holds either a display name ("Acme Inc") or a domain ("martechs.io").
const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function asNonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

async function run(lead: LeadRow): Promise<StepResult> {
  if (!DEEPLINE_API_KEY) return { skipped: "missing-key: DEEPLINE_API_KEY" };

  const linkedinUrl = typeof lead.linkedin_url === "string" ? lead.linkedin_url : null;

  if (!linkedinUrl) {
    // Every lead is required to have a linkedin_url (schema: not null), but
    // guard defensively rather than calling Deepline with an empty input.
    return { skipped: "lead has no linkedin_url" };
  }

  // Pass every hint the lead row has: providers match on
  // name + company domain when the LinkedIn URL alone is not in their index,
  // and misses are free so extra hints never add cost.
  const input: PersonEnrichInput = { linkedin_url: linkedinUrl };
  input.first_name = asNonEmpty(lead.first_name);
  input.last_name = asNonEmpty(lead.last_name);
  const company = asNonEmpty(lead.company);
  if (company) {
    if (DOMAIN_LIKE.test(company)) input.company_website = company;
    else input.company_name = company;
  }

  const missSummaries: string[] = [];

  for (const tier of PERSON_WATERFALL) {
    const payload = tier.buildPayload(input);
    if (!payload) {
      missSummaries.push(`${tier.tool}: insufficient input, tier skipped`);
      continue;
    }

    let envelope: unknown;
    try {
      envelope = await executeTool(tier.tool, payload, 110_000);
    } catch (err) {
      // A 429 must bubble up so the pipeline retry + provider cooldown
      // machinery handles it. Any other tier failure (e.g. Apollo
      // credentials not connected on the org) just advances the waterfall.
      if (err instanceof RateLimitError) throw err;
      missSummaries.push(`${tier.tool}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (deeplineFoundResult(envelope)) {
      const { cost_usd, provider } = extractCostAndProvider(envelope, tier.provider);
      return { data: envelope, cost_usd, provider };
    }

    missSummaries.push(`${tier.tool}: no result`);
  }

  // Every tier missed. Definitive, not transient; do not burn retries (see
  // NonRetryableError doc comment in pipeline.ts). Never fabricate a person.
  throw new NonRetryableError(
    `person enrichment waterfall found no match for ${linkedinUrl} (${missSummaries.join("; ")})`
  );
}

const step: StepModule = {
  name: "person",
  column: "person",
  dependsOn: [],
  run,
};

export default step;
