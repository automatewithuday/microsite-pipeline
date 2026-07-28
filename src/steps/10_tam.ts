// Step 10: tam. Runs the Haiku tier via runLlm (the Anthropic API or the Claude
// CLI, per LLM_PROVIDER). Input: company domain + research.response.
//
// prompts/tam.txt is a faithful reconstruction of the original prompt
// (not verbatim): apply the ICP
// filters implied by the research to any TAM/market-size figures in it,
// resolve a range to its HIGH end, output a single integer.
//
// A JSON parse failure or zod validation failure is a step error (thrown),
// never a partial write. maxRetries: 1 means the
// pipeline runner retries the whole call once on any thrown error,
// including a malformed-output failure, before giving up.

import { readFileSync } from "node:fs";

import type { LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { tamSchema, tamJsonSchema } from "../pure/aiSchemas.js";
import { extractJsonObject } from "../pure/extractJson.js";
import { interpolatePrompt } from "../pure/interpolatePrompt.js";
import { runLlm } from "../providers/llm.js";

const PROMPT_TEMPLATE = readFileSync(new URL("../../prompts/tam.txt", import.meta.url), "utf-8");
const TIMEOUT_MS = 100_000;

function readDomain(lead: LeadRow): string | null {
  const companyData = lead.company_data as { merged?: { domain?: unknown } } | null | undefined;
  return typeof companyData?.merged?.domain === "string" ? companyData.merged.domain : null;
}

function readResearchResponse(lead: LeadRow): string | null {
  const research = lead.research as { response?: unknown } | null | undefined;
  return typeof research?.response === "string" ? research.response : null;
}

async function run(lead: LeadRow): Promise<StepResult> {
  const domain = readDomain(lead);
  const research = readResearchResponse(lead);

  if (!domain) {
    return { skipped: "company domain is null" };
  }
  if (!research) {
    return { skipped: "no research response available" };
  }

  const prompt = interpolatePrompt(PROMPT_TEMPLATE, { domain, research });
  const result = await runLlm(prompt, {
    tier: "haiku",
    timeoutMs: TIMEOUT_MS,
    jsonSchema: tamJsonSchema,
  });

  const parsed = extractJsonObject(result.text);
  const validated = tamSchema.parse(parsed);

  // On the subscription CLI, cost_usd is 0 with an explanatory note (no
  // per-call charge). On the Anthropic API path, cost_usd is the real
  // per-call estimate, or cost_unknown for an unpriced model.
  const data: Record<string, unknown> = {
    tamEstimation: validated.tamEstimation,
    // Store scenario counts when present so computeDerived can build the deck's
    // three-tier funnel from the research's own Optimistic/Realistic/Conservative
    // numbers instead of the flat adjustedTam multipliers. Null (not absent)
    // when the research gave a single number, so the fallback path is explicit.
    tamRealistic: validated.tamRealistic ?? null,
    tamConservative: validated.tamConservative ?? null,
    raw: result.raw,
  };
  if (result.subscription) data.cost_note = "claude subscription, not per-call billed";
  else if (result.cost_usd === null) data.cost_unknown = true;

  return {
    data,
    cost_usd: result.subscription ? 0 : (result.cost_usd ?? 0),
    provider: result.provider,
  };
}

const step: StepModule = {
  name: "tam",
  column: "tam",
  dependsOn: ["research"],
  timeoutMs: 110_000,
  maxRetries: 1,
  run,
};

export default step;
