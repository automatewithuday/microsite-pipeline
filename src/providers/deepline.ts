// Deepline v2 client. Shapes verified against the real API on 2026-07-22/23
// by inspecting the published deepline npm CLI source (dist/cli/index.mjs)
// and the free tool-metadata endpoints, then confirmed live with a real
// test lead.
//
// Real API (differs from the public docs pages and initial assumptions):
//   - Execution endpoint (what `deepline tools execute` calls):
//       POST https://code.deepline.com/api/v2/integrations/{toolId}/execute
//       Body: { "payload": { ...tool input... } }
//       Headers: Authorization: Bearer $DEEPLINE_API_KEY,
//         x-deepline-execute-response-contract: v2-tool-response,
//         x-deepline-execute-response-intent: raw,
//         x-deepline-include-tool-metadata: true
//   - Both tools used here run synchronously (defaultExecutionMode "sync");
//     no submit-then-poll cycle is needed. The plays/run endpoint in the docs
//     is a different, higher-level surface not used by this pipeline.
//   - Response is an execution envelope:
//       { status, job_id?, meta?, toolResponse: { raw, meta }, billing?,
//         extractedValues?, extractedLists?, _metadata? }
//     Raw provider data lives at toolResponse.raw. status values observed in
//     the CLI: "completed", "failed", "no_result", "error".
//   - Tool catalog with pricing is public: GET /api/v2/tools
//     (prospeo_enrich_person: 0.55 credits / $0.055 per result;
//      enrich_company: 0.98 credits / $0.098 per call; $0.10 per credit).
//
// Tool choices for this pipeline:
//   - Person: prospeo_enrich_person (the account's BYOK Prospeo provider),
//     input { linkedin_url } alone is the documented high-accuracy path.
//     Its raw response includes a company record with name, website, domain,
//     and linkedin_url, which is what step 02 keys on.
//   - Company: enrich_company (deepline_native), input takes domain (best),
//     company_name, or linkedin (page id or full company URL).

import { DEEPLINE_API_KEY } from "../db.js";
import { isCoolingDown, RateLimitError, remainingCooldownMs, setCooldown } from "../providerCooldown.js";

const BASE_URL = "https://code.deepline.com";
const DEFAULT_COOLDOWN_MS = 30_000;

export const PERSON_ENRICH_TOOL = "prospeo_enrich_person";
export const PERSON_ENRICH_TOOL_APOLLO = "apollo_enrich_person";
export const PERSON_ENRICH_TOOL_NATIVE = "enrich_contact";
export const COMPANY_ENRICH_TOOL = "enrich_company";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes one Deepline tool synchronously and returns the full execution
 * envelope (never trimmed; the step stores it whole). `timeoutMs` aborts the
 * HTTP request.
 */
export async function executeTool(
  toolId: string,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  if (isCoolingDown("deepline")) {
    await sleep(remainingCooldownMs("deepline"));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}/api/v2/integrations/${encodeURIComponent(toolId)}/execute`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEEPLINE_API_KEY}`,
        "Content-Type": "application/json",
        "x-deepline-execute-response-contract": "v2-tool-response",
        "x-deepline-execute-response-intent": "raw",
        "x-deepline-include-tool-metadata": "true",
      },
      body: JSON.stringify({ payload }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      setCooldown("deepline", DEFAULT_COOLDOWN_MS);
      throw new RateLimitError("deepline");
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Deepline tool "${toolId}" failed (${res.status}): ${body.slice(0, 500)}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export interface PersonEnrichInput {
  linkedin_url: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  company_website?: string;
}

// The tool's input schema recommends linkedin_url alone for accuracy, but a
// profile missing from Prospeo's URL index can still match on
// name + company_website, so callers pass the hints they have. Misses are
// free (per_result pricing, confirmed via the billing ledger), so richer
// input never costs more on a miss.
export async function enrichPerson(input: PersonEnrichInput, timeoutMs: number): Promise<unknown> {
  const payload: Record<string, unknown> = { linkedin_url: input.linkedin_url };
  if (input.first_name) payload.first_name = input.first_name;
  if (input.last_name) payload.last_name = input.last_name;
  if (input.company_name) payload.company_name = input.company_name;
  if (input.company_website) payload.company_website = input.company_website;
  return executeTool(PERSON_ENRICH_TOOL, payload, timeoutMs);
}

export interface PersonWaterfallTier {
  tool: string;
  provider: string;
  buildPayload(input: PersonEnrichInput): Record<string, unknown> | null;
}

function linkedinSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

// Waterfall tiers, in cost order: BYOK Prospeo first
// ($0.055/result, misses free), Apollo second (free through Deepline when
// the org has Apollo credentials connected; a missing-credentials error just
// advances the waterfall), Deepline-native enrich_contact last
// ($0.098 per matched contact with an email, managed credits).
export const PERSON_WATERFALL: PersonWaterfallTier[] = [
  {
    tool: PERSON_ENRICH_TOOL,
    provider: "prospeo",
    buildPayload: (input) => {
      const payload: Record<string, unknown> = { linkedin_url: input.linkedin_url };
      if (input.first_name) payload.first_name = input.first_name;
      if (input.last_name) payload.last_name = input.last_name;
      if (input.company_name) payload.company_name = input.company_name;
      if (input.company_website) payload.company_website = input.company_website;
      return payload;
    },
  },
  {
    tool: PERSON_ENRICH_TOOL_APOLLO,
    provider: "apollo",
    buildPayload: (input) => {
      const payload: Record<string, unknown> = { linkedin_url: input.linkedin_url };
      if (input.first_name) payload.first_name = input.first_name;
      if (input.last_name) payload.last_name = input.last_name;
      if (input.company_website) payload.domain = input.company_website;
      if (input.company_name) payload.organization_name = input.company_name;
      // Never spend Apollo credits revealing personal emails.
      payload.reveal_personal_emails = false;
      return payload;
    },
  },
  {
    tool: PERSON_ENRICH_TOOL_NATIVE,
    provider: "deepline_native",
    buildPayload: (input) => {
      const slug = linkedinSlug(input.linkedin_url);
      const payload: Record<string, unknown> = {};
      if (slug) payload.linkedin = slug;
      if (input.first_name) payload.first_name = input.first_name;
      if (input.last_name) payload.last_name = input.last_name;
      if (input.company_website) payload.domain = input.company_website;
      // Without at least a slug or a name+domain pair this tier cannot match.
      if (!slug && !(input.first_name && input.company_website)) return null;
      return payload;
    },
  },
];

export interface CompanyEnrichInput {
  domain?: string;
  company_name?: string;
  linkedin?: string;
}

export async function enrichCompany(input: CompanyEnrichInput, timeoutMs: number): Promise<unknown> {
  const payload: Record<string, unknown> = {};
  if (input.domain) payload.domain = input.domain;
  if (input.company_name) payload.company_name = input.company_name;
  if (input.linkedin) payload.linkedin = input.linkedin;
  return executeTool(COMPANY_ENRICH_TOOL, payload, timeoutMs);
}
