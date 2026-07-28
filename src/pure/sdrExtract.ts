// Extraction for step 06 (sdr): Deepline forager_person_role_search_totals
// tool output. No I/O, no LLM calls.
//
// Live-verified 2026-07-23 against real API responses: the real
// output shape is { total_search_results, total_persons,
// total_organizations }. total_persons is the deliverable
// (count is the deliverable). Earlier docs-derived guesses (peopleCount,
// totalCount, total, count) are kept as fallbacks in case the tool's
// response shape varies by query type.
const COUNT_FIELD_CANDIDATES = ["total_persons", "peopleCount", "totalCount", "total", "count"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractPeopleCount(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  for (const field of COUNT_FIELD_CANDIDATES) {
    const value = raw[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}
