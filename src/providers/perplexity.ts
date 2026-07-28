// Thin client for the Perplexity Sonar API (deep research fallback,
// RESEARCH_PROVIDER=perplexity). Docs-derived (docs.perplexity.ai,
// OpenAI-compatible chat/completions shape, confirmed 2026-07-23 via
// search, not live-tested). Endpoint
// POST https://api.perplexity.ai/chat/completions, Bearer auth, model
// "sonar", response choices[0].message.content plus a usage object of
// {prompt_tokens, completion_tokens, total_tokens} (token counts, not a
// dollar figure -- cost is derived from Perplexity's published per-token
// sonar pricing, $1/million tokens each way at build time; this is a
// documented rate, not a fabricated one, but still flagged for live
// confirmation since token pricing can change).

import { PERPLEXITY_API_KEY } from "../db.js";

const BASE_URL = "https://api.perplexity.ai";
const MODEL = "sonar";

// Published sonar pricing at build time (docs.perplexity.ai), USD per token.
const USD_PER_TOKEN = 1 / 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface DeepResearchResult {
  text: string;
  raw: unknown;
  /** Real token-based cost when a usage field is present; null when not. */
  cost_usd: number | null;
}

export async function runPerplexityResearch(prompt: string, timeoutMs: number): Promise<DeepResearchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Perplexity research request failed (${res.status}): ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = isRecord(choices[0]) ? choices[0] : null;
    const message = first && isRecord(first.message) ? first.message : null;
    const text = message && typeof message.content === "string" ? message.content : "";

    const usage = isRecord(data.usage) ? data.usage : null;
    const totalTokens = usage && typeof usage.total_tokens === "number" ? usage.total_tokens : null;

    return { text, raw: data, cost_usd: totalTokens === null ? null : totalTokens * USD_PER_TOKEN };
  } finally {
    clearTimeout(timer);
  }
}
