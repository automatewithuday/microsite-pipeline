// Extraction of the Deepline-native fallback payloads for steps 04/05 when
// Apify is unavailable (e.g. monthly usage limit). No I/O, no LLM calls.
//
// Shapes confirmed live against coldiq.com (2026-07-28) and cyndx.com (2026-07-29):
//   adyntel_google   raw: { ads, continuation_token, total_ad_count }
//   adyntel_linkedin raw: { page_id, total_ads, ads, is_last_page, ... }
//   adyntel_facebook raw: "" (empty string, coldiq.com) OR
//     { page_id, number_of_ads, results, ... } (object, cyndx.com)
//   dataforseo_dataforseo_labs_google_domain_rank_overview_live raw:
//     { tasks: [{ result: [{ items: [{ metrics: { organic: { etv }, paid: { etv } } }] }] }] }
//
// DataForSEO etv is estimated monthly traffic from Google search only, not
// SimilarWeb-style total site visits; source_field records that so the
// number is never mistaken for the full-traffic figure.

import type { TrafficExtraction } from "./trafficExtract.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Ad count from an Adyntel raw payload (any of the three channels).
 * Empty string means the tool ran but found nothing: count 0. A payload
 * with no recognizable count field is null -- callers decide whether that
 * is a skip or an error.
 */
export function extractAdyntelAdCount(raw: unknown): number | null {
  if (typeof raw === "string") {
    if (raw.trim().length === 0) return 0;
    try {
      return extractAdyntelAdCount(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (!isRecord(raw)) return null;

  for (const field of ["total_ad_count", "total_ads", "number_of_ads"]) {
    const value = raw[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  if (Array.isArray(raw.ads)) return raw.ads.length;
  if (Array.isArray(raw.results)) return raw.results.length;
  return null;
}

/**
 * Traffic figures from a DataForSEO Labs domain-rank-overview raw payload.
 * Null when the tasks/result/items path is absent or organic etv is not a
 * number (no data for the domain) -- callers should skip, not error.
 */
export function extractDataforseoTraffic(raw: unknown): TrafficExtraction | null {
  if (!isRecord(raw) || !Array.isArray(raw.tasks)) return null;
  const task = raw.tasks[0];
  if (!isRecord(task) || !Array.isArray(task.result)) return null;
  const result = task.result[0];
  if (!isRecord(result) || !Array.isArray(result.items)) return null;
  const item = result.items[0];
  if (!isRecord(item) || !isRecord(item.metrics)) return null;

  const organic = isRecord(item.metrics.organic) ? item.metrics.organic : {};
  const paid = isRecord(item.metrics.paid) ? item.metrics.paid : {};

  const organicEtv = organic.etv;
  if (typeof organicEtv !== "number" || !Number.isFinite(organicEtv)) return null;
  const paidEtv = typeof paid.etv === "number" && Number.isFinite(paid.etv) ? paid.etv : 0;

  return {
    totalVisits: Math.round(organicEtv + paidEtv),
    paidSearchVisits: Math.round(paidEtv),
    source_field: "dataforseo_etv",
  };
}
