// Loads dotenv exactly once. Every other file imports config/helpers/types
// from this module; nothing else calls dotenv directly.
//
// This module holds configuration and pure helpers only. Persistence lives
// behind the state backend (src/state/*), so importing this file never opens
// a database connection.

import "dotenv/config";

// "skipped" is an intentional outcome (missing key, gate miss) that dependents
// may build on; "blocked" means a dependency errored, so dependents must wait
// for the retry instead of running against missing data.
export type StepState = "done" | "error" | "skipped" | "blocked";

export interface StepStatusEntry {
  state: StepState;
  at: string;
  error?: string | null;
  cost_usd?: number;
  provider?: string;
}

export interface LeadRow {
  id: string;
  step_status: Record<string, StepStatusEntry> | null;
  [key: string]: unknown;
}

const missingRequired: string[] = [];

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    missingRequired.push(name);
    return "";
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

// ---------------------------------------------------------------------
// Core switches (read first: they decide which vars below are required).
// ---------------------------------------------------------------------

// Which backend drives the LLM steps (07 research, 10 tam, 11 icp, 12 signals).
//   "api"        (default) — the Anthropic API with the user's ANTHROPIC_API_KEY.
//   "claude_cli"           — the headless `claude` CLI on a Claude subscription.
export const LLM_PROVIDER = optional("LLM_PROVIDER") ?? "api";

if (LLM_PROVIDER !== "api" && LLM_PROVIDER !== "claude_cli") {
  throw new Error(`LLM_PROVIDER must be "api" or "claude_cli", got "${LLM_PROVIDER}"`);
}

// ---------------------------------------------------------------------
// Conditionally-required config. Only the vars the chosen backends need
// are required; the fail-fast block below names any that are missing.
// ---------------------------------------------------------------------

// Anthropic API key: required only when LLM_PROVIDER=api. Kept as a string
// (empty when absent) so callers can guard with a plain truthiness check.
export const ANTHROPIC_API_KEY =
  LLM_PROVIDER === "api" ? required("ANTHROPIC_API_KEY") : (optional("ANTHROPIC_API_KEY") ?? "");

// RESEARCH_PROVIDER selects the research backend (step 07) and which key is
// required. "claude" (default) uses the Claude LLM (API or CLI per
// LLM_PROVIDER) with web search and needs no research key. "parallel"
// requires PARALLEL_API_KEY. "perplexity" requires PERPLEXITY_API_KEY.
export const RESEARCH_PROVIDER = optional("RESEARCH_PROVIDER") ?? "claude";

export const PARALLEL_API_KEY =
  RESEARCH_PROVIDER === "parallel" ? required("PARALLEL_API_KEY") : optional("PARALLEL_API_KEY");
export const PERPLEXITY_API_KEY =
  RESEARCH_PROVIDER === "perplexity" ? required("PERPLEXITY_API_KEY") : optional("PERPLEXITY_API_KEY");

// Provider keys for enrichment/scraping steps are OPTIONAL: a step whose key
// is absent skips cleanly (graceful degradation), so a partial-key run still
// produces a lighter microsite. Kept as strings (empty when absent) so steps
// can guard with `if (!KEY)`.
export const DEEPLINE_API_KEY = optional("DEEPLINE_API_KEY") ?? "";
export const APIFY_TOKEN = optional("APIFY_TOKEN") ?? "";
export const FIRECRAWL_API_KEY = optional("FIRECRAWL_API_KEY") ?? "";

// ADS_TRAFFIC_PROVIDER selects the route for traffic + ad counts (steps 04/05).
//   "auto"     (default) — Apify when its token/actors are configured, with the
//                          Deepline-native tools (DataForSEO, Adyntel) as the
//                          fallback when Apify is unconfigured or errors.
//   "apify"              — Apify only; never call Deepline for these steps.
//   "deepline"           — Deepline-native tools only; Apify is never called.
export const ADS_TRAFFIC_PROVIDER = optional("ADS_TRAFFIC_PROVIDER") ?? "auto";

if (ADS_TRAFFIC_PROVIDER !== "auto" && ADS_TRAFFIC_PROVIDER !== "apify" && ADS_TRAFFIC_PROVIDER !== "deepline") {
  throw new Error(`ADS_TRAFFIC_PROVIDER must be "auto", "apify", or "deepline", got "${ADS_TRAFFIC_PROVIDER}"`);
}

/**
 * Fails fast before a pipeline run, naming every missing required var at once
 * (never a value). Only the reduced, mode-dependent required set can appear
 * here. Deliberately a function rather than an import-time throw: scripts
 * that never call the LLM (serve, seed) must load keyless, so only
 * scripts/run.ts calls this before doing real work. The providers still
 * guard their own keys at call time as a second line of defense.
 */
export function assertRequiredEnv(): void {
  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missingRequired.join(", ")}. ` +
        "Run `npm run setup`, or edit .env (see .env.example)."
    );
  }
}

// ---------------------------------------------------------------------
// Optional config (no step fails at import for these).
// ---------------------------------------------------------------------

// LLM model tiers for the Anthropic API path (LLM_PROVIDER=api). Overridable
// so a user can trade cost for quality without touching code.
export const ANTHROPIC_MODEL_HAIKU = optional("ANTHROPIC_MODEL_HAIKU") ?? "claude-haiku-4-5";
export const ANTHROPIC_MODEL_SONNET = optional("ANTHROPIC_MODEL_SONNET") ?? "claude-sonnet-4-6";

// Path to the headless `claude` binary (LLM_PROVIDER=claude_cli). Defaults to
// the bare command resolved via PATH.
export const CLAUDE_CLI_PATH = optional("CLAUDE_CLI_PATH") ?? "claude";

// When true, the render gate enforces the strict operator ruleset (logo +
// brand color + qualified). Default (false) is the looser public gate.
export const RENDER_STRICT = (optional("RENDER_STRICT") ?? "").toLowerCase() === "true";

// Local state paths (SQLite database + artifact output directory).
export const OUTPUT_DIR = optional("OUTPUT_DIR") ?? "output";
export const LOCAL_DB_PATH = optional("LOCAL_DB_PATH") ?? "local.db";

// Netlify personal access token: required only when deploying follow-up decks
// (scripts/followup.ts approve). Never printed.
export const NETLIFY_AUTH_TOKEN = optional("NETLIFY_AUTH_TOKEN") ?? "";

export const BRANDFETCH_API_KEY = optional("BRANDFETCH_API_KEY");
export const APIFY_ACTOR_SIMILARWEB = optional("APIFY_ACTOR_SIMILARWEB");
export const APIFY_ACTOR_META_ADS = optional("APIFY_ACTOR_META_ADS");
export const APIFY_ACTOR_GOOGLE_ADS = optional("APIFY_ACTOR_GOOGLE_ADS");
export const APIFY_ACTOR_LINKEDIN_ADS = optional("APIFY_ACTOR_LINKEDIN_ADS");
export const APIFY_ACTOR_LI_COMPANY = optional("APIFY_ACTOR_LI_COMPANY");

/**
 * Reads the state of a single step off a lead row's step_status JSONB column.
 * Pure: operates on an in-memory row, no I/O.
 */
export function getStepState(lead: LeadRow, step: string): string | undefined {
  return lead.step_status?.[step]?.state;
}
