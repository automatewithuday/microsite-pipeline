// Extraction of cost/provider metadata and a "did the tool find something"
// signal from a Deepline v2 execution envelope. No I/O, no LLM calls.
//
// Envelope shape confirmed from the published deepline npm CLI source and
// live calls:
//   { status, toolResponse: { raw, meta }, billing?, meta?, _metadata? }
// status values observed in the CLI: "completed", "failed", "no_result",
// "error". billing is typed Record<string, unknown> in the SDK, so the cost
// extractor checks several field-name candidates and degrades to the
// caller-supplied fallback provider with cost 0 when nothing matches; the
// stored raw envelope always allows recomputation later.

const USD_PER_CREDIT = 0.1;

// Round to a tenth of a cent to avoid binary floating point noise
// (e.g. 3 * 0.1 !== 0.3) while keeping sub-cent tool prices exact.
const toUsd = (credits: number): number => Math.round(credits * USD_PER_CREDIT * 1000) / 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export interface CostAndProvider {
  cost_usd: number;
  provider: string;
}

export function extractCostAndProvider(envelope: unknown, fallbackProvider: string): CostAndProvider {
  if (!isRecord(envelope)) return { cost_usd: 0, provider: fallbackProvider };

  const billing = isRecord(envelope.billing) ? envelope.billing : null;
  if (!billing) return { cost_usd: 0, provider: fallbackProvider };

  const provider =
    typeof billing.provider === "string" && billing.provider.length > 0
      ? billing.provider
      : fallbackProvider;

  const usd = firstNumber(billing, ["usd", "usd_amount", "total_usd", "cost_usd", "amount_usd"]);
  if (usd !== null) return { cost_usd: usd, provider };

  const credits = firstNumber(billing, [
    "credits",
    "credits_charged",
    "total_credits",
    "credit_amount",
    "amount_credits",
  ]);
  if (credits !== null) return { cost_usd: toUsd(credits), provider };

  return { cost_usd: 0, provider };
}

/**
 * Unwraps a Deepline v2 execution envelope down to toolResponse.raw, the
 * provider payload every extractor reads from. A small shared helper
 * so step modules don't each re-derive the same
 * envelope.toolResponse.raw chain that 02_enrichCompany.ts's
 * unwrapCompanyResult already does inline.
 */
export function unwrapRaw(envelope: unknown): Record<string, unknown> | null {
  if (!isRecord(envelope)) return null;
  const toolResponse = isRecord(envelope.toolResponse) ? envelope.toolResponse : null;
  const raw = toolResponse && isRecord(toolResponse.raw) ? toolResponse.raw : null;
  return raw;
}

const MISS_STATUSES = new Set(["no_result", "failed", "error", "cancelled"]);

export function deeplineFoundResult(envelope: unknown): boolean {
  if (!isRecord(envelope)) return false;

  if (typeof envelope.status === "string" && MISS_STATUSES.has(envelope.status)) return false;

  const toolResponse = isRecord(envelope.toolResponse) ? envelope.toolResponse : null;
  const raw = toolResponse ? toolResponse.raw : undefined;
  if (!isRecord(raw)) return false;

  // Prospeo raw responses carry an error boolean; true means no usable data.
  if (raw.error === true) return false;

  const keys = Object.keys(raw).filter((k) => k !== "error");
  return keys.length > 0;
}
