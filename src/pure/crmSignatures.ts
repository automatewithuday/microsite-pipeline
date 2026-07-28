// Deterministic CRM detection from homepage (or secondary page) HTML.
// No I/O, no LLM calls. Signatures verbatim from the original ruleset.
// First hit wins,
// priority order is significant (Salesforce before HubSpot etc.).

export const CRM_SIGNATURES: [string, RegExp][] = [
  ["Salesforce", /(pi\.pardot\.com|pardot\.com|salesforce\.com|force\.com|sfdcstatic)/i],
  ["HubSpot", /(js\.hs-scripts\.com|js\.hsforms\.net|hs-analytics\.net|hubspot\.com\/api)/i],
  ["Pipedrive", /(leadbooster-chat\.pipedrive\.com|webforms\.pipedrive\.com)/i],
  ["Close CRM", /(app\.close\.com|close\.com\/api)/i],
  ["Attio", /attio\.com/i],
  ["Folk CRM", /folk\.app/i],
];

export interface CrmDetectionResult {
  platform: string | null;
  matched: string | null;
}

export function detectCrm(html: string): CrmDetectionResult {
  for (const [platform, pattern] of CRM_SIGNATURES) {
    const match = html.match(pattern);
    if (match) {
      return { platform, matched: match[0].toLowerCase() };
    }
  }
  return { platform: null, matched: null };
}
