// Step 12: sales_signals. Runs the Sonnet tier via runLlm (the Anthropic API or
// the Claude CLI, per LLM_PROVIDER).
//
// prompts/sales-signals.txt is the original prompt VERBATIM (not a
// reconstruction), plus a trailing JSON-output-shape instruction this step
// needs to parse the answer (the redacted original had none documented).
//
// A JSON parse failure or zod validation failure (not exactly 3 signals, or
// a signal over 25 words) is a step error, never a partial write.

import { readFileSync } from "node:fs";

import type { LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { salesSignalsSchema, salesSignalsJsonSchema } from "../pure/aiSchemas.js";
import { extractJsonObject } from "../pure/extractJson.js";
import { interpolatePrompt } from "../pure/interpolatePrompt.js";
import { buildSalesSignalsPlaceholders } from "../pure/salesSignalsData.js";
import { runLlm } from "../providers/llm.js";

const PROMPT_TEMPLATE = readFileSync(new URL("../../prompts/sales-signals.txt", import.meta.url), "utf-8");
const TIMEOUT_MS = 100_000;

async function run(lead: LeadRow): Promise<StepResult> {
  const placeholders = buildSalesSignalsPlaceholders(lead);
  if (!placeholders) {
    return { skipped: "no company name or research response available for sales signals" };
  }

  const prompt = interpolatePrompt(PROMPT_TEMPLATE, placeholders);
  const result = await runLlm(prompt, {
    tier: "sonnet",
    timeoutMs: TIMEOUT_MS,
    jsonSchema: salesSignalsJsonSchema,
  });

  const parsed = extractJsonObject(result.text);
  const validated = salesSignalsSchema.parse(parsed);

  const data: Record<string, unknown> = {
    signals: validated.signals,
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
  name: "sales_signals",
  column: "sales_signals",
  dependsOn: ["crm", "traffic", "ads_meta", "ads_google", "ads_linkedin", "founders", "sdr", "research"],
  timeoutMs: 110_000,
  maxRetries: 1,
  run,
};

export default step;
