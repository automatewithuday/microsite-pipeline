// Step 06 (founders): founders. Deepline people search, replacing the
// deprecated Discolike founders lookup (design approved 2026-07-23).
// Two Deepline calls:
//   1. aviato_get_company_founders ($0.014/call) -> founders[0].
//   2. aviato_person_enrich (cost "calculated at execution", read from the
//      billing envelope) on founders[0]'s LinkedIn URL -> linkedinFollowers.
//
// Live-verified 2026-07-23 against real API responses: both
// tools reject domain/linkedin_url with a 422 whose body lists
// accepted_fields. The schema for aviato_get_company_founders *accepts*
// {page, perPage, website, linkedinURL}, but a second live test 2026-07-23
// (clay.com) showed that actually SENDING linkedinURL makes the tool 404
// with UPSTREAM_NOT_FOUND, even alongside a valid website. So we send
// website when we have a domain and only fall back to linkedinURL when we
// do not (see payload build below). aviato_person_enrich takes {linkedinURL}.
// Output field names (firstName, URLs.linkedin, linkedinFollowers) matched
// the pre-existing candidate lists in src/pure/foundersExtract.ts on the
// first live call, no extractor changes needed.

import { DEEPLINE_API_KEY, type LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { RateLimitError } from "../providerCooldown.js";
import { executeTool } from "../providers/deepline.js";
import { deeplineFoundResult, extractCostAndProvider, unwrapRaw } from "../pure/deeplineMeta.js";
import { extractFirstFounder, extractLinkedinFollowers } from "../pure/foundersExtract.js";

const FOUNDERS_TOOL = "aviato_get_company_founders";
const PERSON_ENRICH_TOOL = "aviato_person_enrich";

interface EmployerCompany {
  domain?: string;
  linkedin_url?: string;
}

function readEmployerCompany(lead: LeadRow): EmployerCompany {
  const companyData = lead.company_data as { merged?: { domain?: unknown; url?: unknown } } | null | undefined;
  const domain = typeof companyData?.merged?.domain === "string" ? companyData.merged.domain : undefined;
  const linkedin_url = typeof companyData?.merged?.url === "string" ? companyData.merged.url : undefined;
  return { domain, linkedin_url };
}

async function run(lead: LeadRow): Promise<StepResult> {
  if (!DEEPLINE_API_KEY) return { skipped: "missing-key: DEEPLINE_API_KEY" };

  const employer = readEmployerCompany(lead);

  if (!employer.domain && !employer.linkedin_url) {
    return { skipped: "no company domain or LinkedIn URL for founders search" };
  }

  // aviato_get_company_founders rejects a call missing pagination with a 422
  // ("perPage: Missing required field.; page: Missing required field.").
  // Confirmed live 2026-07-23: page:1, perPage:10 is accepted. We only ever
  // read founders[0], so a small page size is enough. The tool's accepted
  // company identifier fields (from the live 422 validation error's
  // accepted_fields list) are website and linkedinURL, not domain /
  // linkedin_url; "domain" and "linkedin_url" are rejected outright with
  // additionalProperties errors.
  // Prefer website; do NOT also pass linkedinURL. Live-verified 2026-07-23
  // (clay.com): passing linkedinURL (a LinkedIn *company* page URL, which is
  // what company_data.merged.url holds) makes aviato_get_company_founders
  // 404 with UPSTREAM_NOT_FOUND, even alongside a valid website. website
  // alone hits. Only fall back to linkedinURL when there is no domain.
  const foundersPayload: Record<string, unknown> = { page: 1, perPage: 10 };
  if (employer.domain) foundersPayload.website = employer.domain;
  else if (employer.linkedin_url) foundersPayload.linkedinURL = employer.linkedin_url;

  const foundersEnvelope = await executeTool(FOUNDERS_TOOL, foundersPayload, 60_000);

  // A "no founders found" result is a legitimate, non-fabricatable miss, not
  // a transient failure: return skipped directly rather than throwing, so
  // the runner never retries this paid-per-call lookup (retries only fire
  // on a thrown error, see pipeline.ts runStepWithRetries). The
  // aviato_get_company_founders call was already paid for even on a miss,
  // so its real cost/provider are recorded on the skip result rather than
  // vanishing (pipeline.ts markStep records cost_usd on a skipped step
  // when the result carries one).
  if (!deeplineFoundResult(foundersEnvelope)) {
    const billing = extractCostAndProvider(foundersEnvelope, "aviato");
    return { skipped: "no founders", cost_usd: billing.cost_usd, provider: billing.provider };
  }

  const founder = extractFirstFounder(unwrapRaw(foundersEnvelope));
  if (!founder) {
    const billing = extractCostAndProvider(foundersEnvelope, "aviato");
    return { skipped: "no founders", cost_usd: billing.cost_usd, provider: billing.provider };
  }

  let enrichEnvelope: unknown = null;
  let num_followers: number | null = null;

  if (founder.linkedin_url) {
    try {
      // aviato_person_enrich also rejects linkedin_url (422, "Did you mean
      // linkedinURL?"); confirmed live 2026-07-23.
      enrichEnvelope = await executeTool(PERSON_ENRICH_TOOL, { linkedinURL: founder.linkedin_url }, 60_000);
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      // Enrich failing (e.g. provider miss) still leaves us with a usable
      // first_name from the founders call; keep going, never fabricate
      // followers.
      enrichEnvelope = null;
    }

    if (enrichEnvelope && deeplineFoundResult(enrichEnvelope)) {
      num_followers = extractLinkedinFollowers(unwrapRaw(enrichEnvelope));
    }
  }

  const foundersBilling = extractCostAndProvider(foundersEnvelope, "aviato");
  const enrichBilling = extractCostAndProvider(enrichEnvelope, "aviato");

  const data = {
    first_name: founder.first_name,
    num_followers,
    founders_raw: foundersEnvelope,
    enrich_raw: enrichEnvelope,
  };

  return {
    data,
    cost_usd: foundersBilling.cost_usd + enrichBilling.cost_usd,
    provider: "aviato",
  };
}

const step: StepModule = {
  name: "founders",
  column: "founders",
  dependsOn: ["company"],
  run,
};

export default step;
