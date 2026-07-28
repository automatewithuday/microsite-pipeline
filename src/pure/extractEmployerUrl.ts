// Extracts the current employer's company record from a Deepline
// prospeo_enrich_person execution envelope (Clay's experience[0].url
// equivalent, but richer: the real payload carries name, website, domain,
// and LinkedIn URL directly). No I/O, no LLM calls.
//
// Real shape (confirmed from the tool's published output schema and a live
// call): toolResponse.raw.company holds
// { company_id, name, website, domain, linkedin_url }. The tool's own
// extractor metadata also documents raw.person.company as an alternate
// location, so both are checked.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export interface EmployerCompany {
  name: string | null;
  website: string | null;
  domain: string | null;
  linkedin_url: string | null;
}

function normalizeRecord(company: Record<string, unknown>): EmployerCompany | null {
  const result: EmployerCompany = {
    name: asString(company.name) ?? asString(company.company_name),
    website: asString(company.website) ?? asString(company.website_url) ?? asString(company.company_website),
    domain: asString(company.domain) ?? asString(company.primary_domain) ?? asString(company.company_domain),
    linkedin_url: asString(company.linkedin_url) ?? asString(company.company_linkedin_url),
  };

  // A record with no name, domain, website, or LinkedIn URL identifies
  // nothing; treat it as absent.
  if (!result.name && !result.domain && !result.website && !result.linkedin_url) return null;

  return result;
}

export function extractEmployerCompany(envelope: unknown): EmployerCompany | null {
  if (!isRecord(envelope)) return null;

  const toolResponse = isRecord(envelope.toolResponse) ? envelope.toolResponse : null;
  const raw = toolResponse && isRecord(toolResponse.raw) ? toolResponse.raw : null;
  if (!raw) return null;

  const person = isRecord(raw.person) ? raw.person : null;
  const output = isRecord(raw.output) ? raw.output : null;
  const outputPerson = output && isRecord(output.person) ? output.person : null;

  // Candidate locations in priority order, covering the three waterfall
  // tiers: Prospeo (raw.company / raw.person.company), Apollo
  // (raw.person.organization), Deepline-native enrich_contact
  // (raw.output.person company_* fields).
  const candidates: Record<string, unknown>[] = [];
  if (isRecord(raw.company)) candidates.push(raw.company);
  if (person && isRecord(person.company)) candidates.push(person.company);
  if (person && isRecord(person.organization)) candidates.push(person.organization);
  if (outputPerson) {
    // enrich_contact mixes person and company fields in one object; only the
    // company_* prefixed fields identify the employer (a bare "name" here
    // would be the person, not the company).
    candidates.push({
      company_name: outputPerson.company_name,
      company_website: outputPerson.company_website,
      company_domain: outputPerson.company_domain,
      company_linkedin_url: outputPerson.company_linkedin_url,
    });
  }

  for (const candidate of candidates) {
    const normalized = normalizeRecord(candidate);
    if (normalized) return normalized;
  }

  return null;
}
