// Shared Deepline Adyntel fallback for the three ads steps. Used when the
// Apify actor is unavailable (unconfigured, or a thrown error such as the
// monthly usage hard limit) and DEEPLINE_API_KEY is set. Adyntel is keyed by
// company_domain, so counts are already scoped to the company -- no
// advertiser-name filtering needed, unlike the Apify keyword searches.
// Payload field name and response shapes confirmed live 2026-07-28
// (see src/pure/adyntelExtract.ts).

import { type StepResult } from "../pipeline.js";
import { extractAdyntelAdCount } from "../pure/adyntelExtract.js";
import { extractCostAndProvider } from "../pure/deeplineMeta.js";
import { executeTool } from "../providers/deepline.js";

const TIMEOUT_MS = 100_000;

export async function runAdyntelFallback(tool: string, domain: string): Promise<StepResult> {
  const envelope = await executeTool(tool, { company_domain: domain }, TIMEOUT_MS);
  const raw = (envelope as { toolResponse?: { raw?: unknown } } | null | undefined)?.toolResponse?.raw;

  // An unrecognizable payload is a step error, never a silent count of 0:
  // shape drift must surface in step_status, not corrupt the deck.
  const count = extractAdyntelAdCount(raw);
  if (count === null) throw new Error(`unrecognizable ${tool} payload shape`);

  const provider = `deepline:${tool}`;
  const { cost_usd } = extractCostAndProvider(envelope, provider);
  return { data: { count, raw: envelope }, cost_usd, provider };
}
