// Step 02: enrich company. Deepline's enrich_company (deepline_native) tool
// first, Apify LinkedIn-company actor as fallback when employee_count or
// description is missing.
//
// Confirmed divergence from initial assumptions: the person response from step 01
// already carries the employer company record (name, website, domain,
// linkedin_url), so this step keys on the domain when available (Deepline's
// documented best input), falling back to the LinkedIn company URL, then the
// company name.

import { ApifyClient } from "apify-client";
import { APIFY_ACTOR_LI_COMPANY, APIFY_TOKEN, DEEPLINE_API_KEY, type LeadRow } from "../db.js";
import { NonRetryableError, type StepModule, type StepResult } from "../pipeline.js";
import { enrichCompany, type CompanyEnrichInput } from "../providers/deepline.js";
import { aliasCompanyFields, mergeCompanyData, type CompanyFields } from "../pure/companyMerge.js";
import { deeplineFoundResult, extractCostAndProvider } from "../pure/deeplineMeta.js";
import { extractEmployerCompany } from "../pure/extractEmployerUrl.js";
import { normalizeDomain } from "../pure/normalize.js";

const FALLBACK_TRIGGER_FIELDS = ["employee_count", "description"] as const;

// The lead.company column holds either a display name ("Acme Inc") or a bare
// domain ("smartlead.ai"). Same loose check step 01 uses.
const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function seedDomain(lead: LeadRow): string | null {
  const company = typeof lead.company === "string" ? lead.company.trim() : "";
  if (company && DOMAIN_LIKE.test(company)) return normalizeDomain(company);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// enrich_company's raw payload location candidates, from the tool's
// published list-extractor metadata: output.company first, then flatter
// shapes as fallbacks.
function unwrapCompanyResult(envelope: unknown): CompanyFields {
  if (!isRecord(envelope)) return {};
  const toolResponse = isRecord(envelope.toolResponse) ? envelope.toolResponse : null;
  const raw = toolResponse && isRecord(toolResponse.raw) ? toolResponse.raw : null;
  if (!raw) return {};

  if (isRecord(raw.output) && isRecord(raw.output.company)) return raw.output.company;
  if (isRecord(raw.company)) return raw.company;
  if (isRecord(raw.data)) return raw.data;
  return raw;
}

function needsFallback(fields: CompanyFields): boolean {
  return FALLBACK_TRIGGER_FIELDS.some(
    (field) => fields[field] === null || fields[field] === undefined
  );
}

async function runApifyLiCompanyActor(companyUrl: string): Promise<CompanyFields | null> {
  if (!APIFY_ACTOR_LI_COMPANY || !APIFY_TOKEN) return null;

  const client = new ApifyClient({ token: APIFY_TOKEN });
  const run = await client.actor(APIFY_ACTOR_LI_COMPANY).call({ url: companyUrl });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const first = items[0];
  return isRecord(first) ? first : null;
}

async function run(lead: LeadRow): Promise<StepResult> {
  if (!DEEPLINE_API_KEY) return { skipped: "missing-key: DEEPLINE_API_KEY" };

  const employer = extractEmployerCompany(lead.person);

  // The seeded lead.company domain is the company we deliberately chose to
  // pitch. It wins over the person payload's primary employer, which is
  // whatever job_history[0] happens to be and can be a different company
  // (e.g. a founder listing a newer venture first). When it is a domain,
  // enrich it directly. The person-derived employer record is still kept for
  // the Apify LinkedIn-company fallback below. (Decision 2026-07-23.)
  const seed = seedDomain(lead);

  if (!employer && !seed) {
    return { skipped: "no employer company record found on the person payload" };
  }

  const input: CompanyEnrichInput = {};
  if (seed) {
    input.domain = seed;
  } else if (employer) {
    const employerDomain = normalizeDomain(employer.domain ?? employer.website);
    if (employerDomain) input.domain = employerDomain;
    else if (employer.linkedin_url) input.linkedin = employer.linkedin_url;
    else if (employer.name) input.company_name = employer.name;
    else return { skipped: "employer record has no domain, LinkedIn URL, or name" };
  }

  const deeplineRaw = await enrichCompany(input, 110_000);

  if (!deeplineFoundResult(deeplineRaw)) {
    throw new NonRetryableError(
      `Deepline company enrichment found no match for ${JSON.stringify(input)}`
    );
  }

  const deeplineFields = unwrapCompanyResult(deeplineRaw);

  let apifyRaw: CompanyFields | null = null;
  let fallbackUnavailable = false;

  if (needsFallback(aliasCompanyFields(deeplineFields))) {
    // Point the Apify fallback at whatever company Deepline actually enriched.
    // When the seed-domain path was taken, employer may be a *different* company
    // (person's job_history[0] vs the seeded lead.company), so scraping
    // employer.linkedin_url would fill the seeded company's nulls from the wrong
    // LinkedIn page and corrupt employee_count (the ICP gate). Use the seeded
    // company's own LinkedIn URL from Deepline's return instead. (Decision 2026-07-23.)
    const apifyUrl = seed
      ? (typeof deeplineFields.linkedin_url === "string" ? deeplineFields.linkedin_url : null)
      : employer?.linkedin_url ?? null;
    if (APIFY_ACTOR_LI_COMPANY && apifyUrl) {
      apifyRaw = await runApifyLiCompanyActor(apifyUrl);
    } else {
      fallbackUnavailable = true;
    }
  }

  const merged = aliasCompanyFields(mergeCompanyData(deeplineFields, apifyRaw));
  const domainSource = typeof merged.domain === "string" ? merged.domain : merged.website;
  if (typeof domainSource === "string") {
    merged.domain = normalizeDomain(domainSource);
  }

  const data: Record<string, unknown> = { merged, deepline_raw: deeplineRaw, apify_raw: apifyRaw };
  if (fallbackUnavailable) data.fallback_unavailable = true;

  const { cost_usd, provider } = extractCostAndProvider(deeplineRaw, "deepline_native");
  return { data, cost_usd, provider };
}

const step: StepModule = {
  name: "company",
  column: "company_data",
  dependsOn: ["person"],
  run,
};

export default step;
