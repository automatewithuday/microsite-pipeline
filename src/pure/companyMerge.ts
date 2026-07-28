// Merge rule for company enrichment:
// Deepline wins on conflict, Apify fills nulls. No I/O, no LLM calls.

export type CompanyFields = Record<string, unknown>;

// Deepline's real enrich_company payload names differ from the canonical
// field names used downstream (observed live 2026-07-22: employees_count vs
// employee_count, linkedin_url vs url). Add the canonical aliases without
// overwriting anything already present and without mutating the input.
const FIELD_ALIASES: [specName: string, realName: string][] = [
  ["employee_count", "employees_count"],
  ["url", "linkedin_url"],
];

export function aliasCompanyFields(fields: CompanyFields): CompanyFields {
  const out: CompanyFields = { ...fields };
  for (const [specName, realName] of FIELD_ALIASES) {
    if (out[specName] === undefined && out[realName] !== undefined && out[realName] !== null) {
      out[specName] = out[realName];
    }
  }
  return out;
}

export function mergeCompanyData(
  deepline: CompanyFields,
  apify: CompanyFields | null | undefined
): CompanyFields {
  if (!apify) return { ...deepline };

  const merged: CompanyFields = { ...deepline };
  for (const [key, apifyValue] of Object.entries(apify)) {
    const deeplineValue = merged[key];
    if (deeplineValue === undefined || deeplineValue === null) {
      merged[key] = apifyValue;
    }
  }
  return merged;
}
