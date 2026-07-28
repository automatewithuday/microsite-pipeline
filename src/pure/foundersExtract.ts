// Extraction for step 06 (founders): Deepline aviato_get_company_founders /
// aviato_person_enrich tool outputs. No I/O, no LLM calls.
//
// UNVERIFIED / docs-derived: aviato's tool catalog entry
// confirms the toolIds and pricing but not the
// input/output field schemas (no public schema endpoint found during the
// build; only the free `GET /api/v2/tools` catalog metadata, which does not
// include `hasInputSchema: true`'s actual schema body). Field-name
// candidates below are the expected shape ("founders[0].first_name",
// "founders[0].URLs.linkedin", "linkedinFollowers") plus common aliasing
// fallbacks, in priority order. Needs a live capture to confirm.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface FirstFounder {
  first_name: string | null;
  linkedin_url: string | null;
}

function foundersArray(raw: unknown): unknown[] | null {
  if (!isRecord(raw)) return null;
  if (Array.isArray(raw.founders)) return raw.founders;
  if (isRecord(raw.output) && Array.isArray(raw.output.founders)) return raw.output.founders;
  if (isRecord(raw.data) && Array.isArray(raw.data.founders)) return raw.data.founders;
  return null;
}

function firstNameOf(founder: Record<string, unknown>): string | null {
  const value = founder.first_name ?? founder.firstName;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function linkedinUrlOf(founder: Record<string, unknown>): string | null {
  const urls = founder.URLs ?? founder.urls;
  if (isRecord(urls) && typeof urls.linkedin === "string") return urls.linkedin;

  const candidates = [founder.linkedin_url, founder.linkedinUrl, founder.linkedin];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

/** Reads founders[0] out of the aviato_get_company_founders raw payload. */
export function extractFirstFounder(raw: unknown): FirstFounder | null {
  const founders = foundersArray(raw);
  if (!founders || founders.length === 0) return null;

  const first = founders[0];
  if (!isRecord(first)) return null;

  return { first_name: firstNameOf(first), linkedin_url: linkedinUrlOf(first) };
}

const FOLLOWERS_FIELD_CANDIDATES = [
  "linkedinFollowers",
  "linkedin_followers",
  "numFollowers",
  "num_followers",
  "followers",
  "followerCount",
];

/** Reads the LinkedIn follower count out of the aviato_person_enrich raw payload. */
export function extractLinkedinFollowers(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  for (const field of FOLLOWERS_FIELD_CANDIDATES) {
    const value = raw[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}
