// Single entry point for the LLM steps (07 research, 10 tam, 11 icp, 12
// signals). Dispatches to the subscription CLI (providers/claudeCli.ts) or the
// Anthropic API (providers/anthropic.ts) by LLM_PROVIDER, and normalizes the
// result so step code barely changes: it carries a provider label and a
// `subscription` flag the step uses to decide cost_usd (0 + a note for the
// subscription CLI, the real per-call estimate for the API).

import { LLM_PROVIDER } from "../db.js";
import { runAnthropic } from "./anthropic.js";
import { runClaude, type ClaudeCliOpts } from "./claudeCli.js";

export interface LlmResult {
  text: string;
  raw: string;
  /** Real per-call estimate on the API path; the CLI's api-equivalent otherwise. null if unknown. */
  cost_usd: number | null;
  /** e.g. "anthropic:claude-sonnet-4-6" or "claude-cli:sonnet". */
  provider: string;
  /** True on the subscription CLI path (no per-call marginal charge). */
  subscription: boolean;
}

export interface LlmOpts {
  tier: "haiku" | "sonnet";
  timeoutMs: number;
  /** Steps 10/11/12: a tool-use input schema; the model emits JSON to match. */
  jsonSchema?: Record<string, unknown>;
  /** Step 07: enable web search / web fetch. */
  webSearch?: boolean;
  /** Prepended to the prompt ONLY on the CLI path (the API has no file tools). */
  cliWebSearchDirective?: string;
}

const CLI_MODEL_BY_TIER: Record<LlmOpts["tier"], string> = { haiku: "haiku", sonnet: "sonnet" };

export async function runLlm(prompt: string, opts: LlmOpts): Promise<LlmResult> {
  if (LLM_PROVIDER === "claude_cli") {
    const cliModel = CLI_MODEL_BY_TIER[opts.tier];
    const cliOpts: ClaudeCliOpts = { model: cliModel, timeoutMs: opts.timeoutMs };
    if (opts.webSearch) {
      // allowedTools only auto-approves; also deny file/shell tools so a long
      // research report always comes back inline (see step 07's note).
      cliOpts.allowedTools = ["WebSearch", "WebFetch"];
      cliOpts.disallowedTools = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"];
    }
    const finalPrompt =
      opts.webSearch && opts.cliWebSearchDirective ? opts.cliWebSearchDirective + prompt : prompt;
    const result = await runClaude(finalPrompt, cliOpts);
    return {
      text: result.text,
      raw: result.raw,
      cost_usd: result.cost_usd,
      provider: `claude-cli:${cliModel}`,
      subscription: true,
    };
  }

  const result = await runAnthropic(prompt, {
    tier: opts.tier,
    timeoutMs: opts.timeoutMs,
    jsonSchema: opts.jsonSchema,
    webSearch: opts.webSearch,
  });
  return {
    text: result.text,
    raw: result.raw,
    cost_usd: result.cost_usd,
    provider: `anthropic:${result.model}`,
    subscription: false,
  };
}
