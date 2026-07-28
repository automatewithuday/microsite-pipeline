// Extraction/normalization of Apify SimilarWeb actor output into the shape
// step 04 stores. No I/O, no LLM calls.
//
// The SimilarWeb Store page (vortex_data/similarweb-scraper, base_data mode,
// docs-derived, not yet live-confirmed) documents totalVisits plus a set of
// traffic-source *shares* (directTraffic, searchTraffic, referralTraffic,
// socialTraffic, displayAdsTraffic, genAiTraffic) as decimal fractions, but
// does not document a field explicitly named "paid search". We treat the
// first share-shaped field in PAID_SHARE_FIELD_CANDIDATES as the closest
// available proxy and note which one we used in `source_field`. This
// candidate list needs live validation against a real dataset item.

const PAID_SHARE_FIELD_CANDIDATES = [
  "paidSearchShare",
  "paidSearchTraffic",
  "paidTrafficShare",
  "paidReferralShare",
  "displayAdsTraffic",
];

export interface TrafficExtraction {
  totalVisits: number;
  paidSearchVisits: number | null;
  source_field: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Returns null when the actor gave no usable data (empty items array, or a
 * single item with no totalVisits) -- callers should mark the step
 * `skipped`, not error (small/new domains often return no data).
 */
export function extractTraffic(items: unknown[]): TrafficExtraction | null {
  const item = items[0];
  if (!isRecord(item)) return null;

  const rawTotal = item.totalVisits;
  if (typeof rawTotal !== "number" || !Number.isFinite(rawTotal)) return null;
  const totalVisits = Math.round(rawTotal);

  for (const field of PAID_SHARE_FIELD_CANDIDATES) {
    const share = item[field];
    if (typeof share === "number" && Number.isFinite(share)) {
      return {
        totalVisits,
        paidSearchVisits: Math.round(share * rawTotal),
        source_field: field,
      };
    }
  }

  return { totalVisits, paidSearchVisits: null, source_field: null };
}
