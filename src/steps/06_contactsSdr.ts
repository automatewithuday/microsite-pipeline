// Step 06 (SDR): sdr. Deepline forager_person_role_search_totals
// (catalog: Free). Counts current SDR/BDR headcount, does not enrich
// individuals (the count is the deliverable). A Crustdata fallback
// is a documented future follow-up, not built here; when the tool
// errors or turns out to be gated, this step still completes with
// peopleCount null rather than failing the row, since sdrInsight
// (formulas.ts) already handles a null/0 SDR count.

import { DEEPLINE_API_KEY, type LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { RateLimitError } from "../providerCooldown.js";
import { executeTool } from "../providers/deepline.js";
import { extractCostAndProvider, unwrapRaw } from "../pure/deeplineMeta.js";
import { extractPeopleCount } from "../pure/sdrExtract.js";

const SDR_TOOL = "forager_person_role_search_totals";

// SDR/BDR title filter. forager_person_role_search_totals rejected the
// array form live (422: "role_title: must be string"). Its live schema
// (via `deepline tools get forager_person_role_search_totals`, confirmed
// 2026-07-23) says role_title "supports a boolean text search query", and a
// plain unquoted multi-word string ("sales development") 422s with "Found
// unknown operation in the provided query": the field parses a boolean DSL,
// not free text. An OR query of quoted phrases covers both SDR and BDR
// titles in one string and returned 200 with a real (zero) count live.
const SDR_ROLE_TITLE =
  'sdr OR bdr OR "sales development representative" OR "business development representative"';

async function run(lead: LeadRow): Promise<StepResult> {
  if (!DEEPLINE_API_KEY) return { skipped: "missing-key: DEEPLINE_API_KEY" };

  const companyData = lead.company_data as { merged?: { domain?: unknown } } | null | undefined;
  const domain = typeof companyData?.merged?.domain === "string" ? companyData.merged.domain : null;

  if (!domain) {
    return { skipped: "no company domain for SDR search" };
  }

  const payload: Record<string, unknown> = {
    organization_domains: [domain],
    role_title: SDR_ROLE_TITLE,
    role_is_current: true,
  };

  let envelope: unknown;
  try {
    envelope = await executeTool(SDR_TOOL, payload, 60_000);
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    // Tool errored or is gated (not actually free / not found on this
    // account): a null SDR count is acceptable, log which path was taken
    // in the stored data rather than failing the row.
    return {
      data: {
        peopleCount: null,
        raw: null,
        fallback: "crustdata_pending",
        error: err instanceof Error ? err.message : String(err),
      },
      cost_usd: 0,
      provider: "forager",
    };
  }

  const peopleCount = extractPeopleCount(unwrapRaw(envelope));
  const { cost_usd, provider } = extractCostAndProvider(envelope, "forager");

  const data: Record<string, unknown> = { peopleCount, raw: envelope };
  if (peopleCount === null) data.fallback = "crustdata_pending";

  return { data, cost_usd, provider };
}

const step: StepModule = {
  name: "sdr",
  column: "sdr",
  dependsOn: ["company"],
  run,
};

export default step;
