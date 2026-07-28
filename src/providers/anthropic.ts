// Anthropic API path for the LLM steps (LLM_PROVIDER=api). Unlike the
// subscription CLI (providers/claudeCli.ts), this bills per call with the
// user's own ANTHROPIC_API_KEY, so a public self-host user can run steps
// 07/10/11/12 without a Claude subscription.
//
// Two modes, matching how the steps use it:
//   - jsonSchema set (steps 10/11/12): a single forced tool whose input_schema
//     is the (lenient) JSON schema; the tool_use.input is returned as JSON
//     text, which the step re-validates with its zod schema (the real check).
//   - webSearch set (step 07): the server-side web_search tool; the model runs
//     the search loop and we return the concatenated text response.

import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL_HAIKU, ANTHROPIC_MODEL_SONNET } from "../db.js";

export interface AnthropicResult {
  text: string;
  raw: string;
  cost_usd: number | null;
  model: string;
}

export interface AnthropicOpts {
  tier: "haiku" | "sonnet";
  timeoutMs: number;
  jsonSchema?: Record<string, unknown>;
  webSearch?: boolean;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    if (!ANTHROPIC_API_KEY) throw new Error("LLM_PROVIDER=api requires ANTHROPIC_API_KEY");
    client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return client;
}

function modelForTier(tier: "haiku" | "sonnet"): string {
  return tier === "haiku" ? ANTHROPIC_MODEL_HAIKU : ANTHROPIC_MODEL_SONNET;
}

// Approximate list prices ($/1M tokens) by model-id prefix. Used to record a
// real cost_usd; returns null for an unrecognized model so the step flags
// cost_unknown rather than a fabricated figure. Excludes the per-search web
// tool fee, so research cost is a lower bound.
const PRICES: Array<{ prefix: string; input: number; output: number }> = [
  { prefix: "claude-haiku-4-5", input: 1, output: 5 },
  { prefix: "claude-sonnet-5", input: 3, output: 15 },
  { prefix: "claude-sonnet-4-6", input: 3, output: 15 },
  { prefix: "claude-opus-5", input: 5, output: 25 },
  { prefix: "claude-opus-4-8", input: 5, output: 25 },
];

function estimateCost(model: string, usage: Anthropic.Usage): number | null {
  const price = PRICES.find((p) => model.startsWith(p.prefix));
  if (!price) return null;
  const inputTokens =
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);
  return (inputTokens * price.input + usage.output_tokens * price.output) / 1_000_000;
}

function textFromContent(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export async function runAnthropic(prompt: string, opts: AnthropicOpts): Promise<AnthropicResult> {
  const model = modelForTier(opts.tier);
  const c = getClient();

  const base: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    // Research reports are large; the synthesis steps emit small JSON.
    max_tokens: opts.webSearch ? 16000 : 2048,
    messages: [{ role: "user", content: prompt }],
  };

  if (opts.jsonSchema) {
    base.tools = [
      {
        name: "emit_result",
        description: "Return the structured result as the tool input.",
        input_schema: opts.jsonSchema as Anthropic.Tool.InputSchema,
      },
    ];
    base.tool_choice = { type: "tool", name: "emit_result" };
  } else if (opts.webSearch) {
    base.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }];
  }

  let messages = base.messages;
  let response = await c.messages.create({ ...base, messages }, { timeout: opts.timeoutMs });

  // The web-search server loop can pause (stop_reason "pause_turn"); resume by
  // re-sending with the assistant turn appended until it completes.
  let guard = 0;
  while (response.stop_reason === "pause_turn" && guard++ < 5) {
    messages = [...messages, { role: "assistant", content: response.content }];
    response = await c.messages.create({ ...base, messages }, { timeout: opts.timeoutMs });
  }

  let text: string;
  if (opts.jsonSchema) {
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) {
      throw new Error(
        `anthropic API returned no tool_use block (stop_reason ${response.stop_reason}): ${textFromContent(response.content).slice(0, 300)}`
      );
    }
    text = JSON.stringify(toolUse.input);
  } else {
    text = textFromContent(response.content);
  }

  return { text, raw: JSON.stringify(response), cost_usd: estimateCost(model, response.usage), model };
}
