// Step 07: research. Default provider is Claude with web search
// (RESEARCH_PROVIDER=claude or unset): it runs via the Anthropic API or the
// local claude CLI per LLM_PROVIDER (no extra research key needed) and
// returns in seconds to a couple of minutes, unlike Parallel deep research which ran 22+ minutes without
// completing (2026-07-23 diagnostic). Parallel and Perplexity Sonar remain
// selectable via RESEARCH_PROVIDER for when a dedicated research API is
// preferred. The most expensive-in-time step: never rerun implicitly,
// only --force reruns a "done" research step.
//
// Retries at most once on a thrown transport error (maxRetries: 1 below).
//
// The verbatim original Sonar prompt is not in this repo.
// prompts/research.txt is a faithful reconstruction, flagged for the
// human to replace with the real prompt if they have it.

import { readFileSync } from "node:fs";

import { RESEARCH_PROVIDER, type LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { interpolatePrompt } from "../pure/interpolatePrompt.js";
import { toHttpUrl } from "../pure/normalize.js";
import { runLlm } from "../providers/llm.js";
import { runParallelDeepResearch } from "../providers/parallel.js";
import { runPerplexityResearch } from "../providers/perplexity.js";

const PROMPT_TEMPLATE = readFileSync(new URL("../../prompts/research.txt", import.meta.url), "utf-8");
const RESEARCH_TIMEOUT_MS = 290_000; // leaves headroom under the step's 300s timeoutMs
// Prepended for the CLI path so the model actually gathers live data rather
// than answering from memory; the report structure follows in the template.
const WEB_SEARCH_DIRECTIVE =
  "Use web search to research the company below, then return the full report " +
  "inline as your text response. Do not write the report to a file or use any " +
  "file-writing tool. Base every claim on what you find, cite sources inline, " +
  "and do not invent numbers.\n\n";

interface CompanyFields {
  name?: unknown;
  description?: unknown;
  domain?: unknown;
  website?: unknown;
  linkedin_url?: unknown;
}

function readCompanyFields(lead: LeadRow): CompanyFields {
  const companyData = lead.company_data as { merged?: CompanyFields } | null | undefined;
  return companyData?.merged ?? {};
}

async function run(lead: LeadRow): Promise<StepResult> {
  const merged = readCompanyFields(lead);
  const companyName =
    typeof merged.name === "string" && merged.name.length > 0
      ? merged.name
      : typeof lead.company === "string"
        ? lead.company
        : null;

  if (!companyName) {
    return { skipped: "no company name available for research" };
  }

  const domain = typeof merged.domain === "string" ? merged.domain : "";
  const description = typeof merged.description === "string" ? merged.description : "";
  const url = toHttpUrl(typeof merged.website === "string" ? merged.website : domain) ?? "";
  const linkedin = typeof merged.linkedin_url === "string" ? merged.linkedin_url : "";

  const prompt = interpolatePrompt(PROMPT_TEMPLATE, {
    Company: companyName,
    description,
    domain,
    url,
    linkedin,
  });

  if (RESEARCH_PROVIDER === "perplexity") {
    const result = await runPerplexityResearch(prompt, RESEARCH_TIMEOUT_MS);
    const data: Record<string, unknown> = { response: result.text, provider: "perplexity", raw: result.raw };
    if (result.cost_usd === null) data.cost_unknown = true;
    return {
      data,
      cost_usd: result.cost_usd ?? 0,
      provider: "perplexity",
    };
  }

  if (RESEARCH_PROVIDER === "parallel") {
    const result = await runParallelDeepResearch(prompt, RESEARCH_TIMEOUT_MS);
    const data: Record<string, unknown> = { response: result.text, provider: "parallel", raw: result.raw };
    // No confirmed cost/usage field surfaced in the docs excerpt available
    // during this build (see providers/parallel.ts). When the provider
    // response carries no usable cost figure, flag cost_unknown rather than
    // silently recording a fabricated or hidden $0.
    if (result.cost_usd === null) data.cost_unknown = true;
    return {
      data,
      cost_usd: result.cost_usd ?? 0,
      provider: "parallel",
    };
  }

  // Default: Claude with web search. On LLM_PROVIDER=claude_cli this runs on the
  // human's subscription (cost 0, api-equivalent figure preserved); on
  // LLM_PROVIDER=api it uses the server-side web search tool with the user's
  // ANTHROPIC_API_KEY and records the real per-call estimate.
  const result = await runLlm(prompt, {
    tier: "sonnet",
    timeoutMs: RESEARCH_TIMEOUT_MS,
    webSearch: true,
    cliWebSearchDirective: WEB_SEARCH_DIRECTIVE,
  });
  const data: Record<string, unknown> = {
    response: result.text,
    provider: result.provider,
    raw: result.raw,
  };
  if (result.subscription) {
    data.cost_note = "claude subscription, not per-call billed";
    data.api_equivalent_cost_usd = result.cost_usd;
  } else if (result.cost_usd === null) {
    data.cost_unknown = true;
  }
  return {
    data,
    cost_usd: result.subscription ? 0 : (result.cost_usd ?? 0),
    provider: result.provider,
  };
}

const step: StepModule = {
  name: "research",
  column: "research",
  dependsOn: ["company"],
  timeoutMs: 300_000,
  maxRetries: 1,
  run,
};

export default step;
