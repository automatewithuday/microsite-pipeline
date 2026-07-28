// Builds the {placeholder} map for prompts/followup-narrative.txt from prior
// step columns. Pure, no I/O. Missing optional data degrades to "unknown";
// only company-name-and-research-both-missing aborts (returns null), matching
// step 12's skip semantics.

import type { LeadRow } from "../db.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readCompany(lead: LeadRow): { name: string; domain: string } {
  const companyData = lead.company_data as { merged?: Record<string, unknown> } | null | undefined;
  const merged = isRecord(companyData?.merged) ? companyData.merged : {};
  const name =
    typeof merged.name === "string" && merged.name
      ? merged.name
      : typeof lead.company === "string"
        ? lead.company
        : "";
  const domain = typeof merged.domain === "string" ? merged.domain : "";
  return { name, domain };
}

function adsLine(lead: LeadRow): string {
  const count = (col: unknown): string =>
    isRecord(col) && typeof col.count === "number" ? String(col.count) : "unknown";
  return `Meta ads live: ${count(lead.ads_meta)}; Google ads live: ${count(lead.ads_google)}; LinkedIn ads live: ${count(lead.ads_linkedin)}`;
}

function jsonOrUnknown(value: unknown): string {
  if (value === null || value === undefined) return "unknown";
  try {
    return JSON.stringify(value);
  } catch {
    return "unknown";
  }
}

export function buildFollowupPlaceholders(
  lead: LeadRow,
  digest: string,
  steer = ""
): Record<string, string> | null {
  const { name, domain } = readCompany(lead);
  const research =
    isRecord(lead.research) && typeof lead.research.response === "string"
      ? lead.research.response
      : "";
  if (!name && !research) return null;

  const crm = isRecord(lead.crm) && typeof lead.crm.platform === "string" ? lead.crm.platform : "unknown";
  const callNotes = typeof lead.call_notes === "string" ? lead.call_notes : "";

  return {
    company: name || "unknown",
    domain: domain || "unknown",
    crm,
    traffic: lead.traffic ? jsonOrUnknown(lead.traffic) : "unknown",
    ads: adsLine(lead),
    research: research || "unknown",
    tam: lead.tam ? jsonOrUnknown(lead.tam) : "unknown",
    icp_segments: lead.icp_segments ? jsonOrUnknown(lead.icp_segments) : "unknown",
    sales_signals: lead.sales_signals ? jsonOrUnknown(lead.sales_signals) : "unknown",
    call_notes: callNotes,
    steer,
    library_digest: digest,
  };
}
