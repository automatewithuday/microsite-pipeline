// Thin client for the headless `claude` CLI (steps 10-12).
// Used when LLM_PROVIDER=claude_cli: runs on a Claude subscription via the
// local `claude` binary instead of the per-call Anthropic API. Invoked via
// execFile (argv array, never a shell string) so the prompt text -- which
// can contain quotes, backticks, or the full research response -- is never
// interpolated into a shell command.
//
// CLI flags confirmed 2026-07-23 via `claude --help` (v2.1.218, help-only
// call, no generation): `-p`/`--print` for non-interactive output,
// `--output-format json` for a single JSON result on stdout, `--model
// <model>` accepting either an alias ("sonnet") or a full model id. The
// help text documents the *flags* but not the JSON envelope's field names
// (no worked example in `--help`); extractResultText()/extractCostUsd()
// below are written defensively against the commonly documented Claude
// Code JSON envelope shape (a top-level `result` string plus optional
// `total_cost_usd`/`usage`), trying several candidate field names rather
// than assuming one exact shape. Confirm against a live generation call on
// first real use.

import { execFile } from "node:child_process";
import { CLAUDE_CLI_PATH } from "../db.js";

export interface ClaudeCliOpts {
  model: string;
  timeoutMs: number;
  /**
   * When set, passed to the CLI as `--allowedTools`, granting exactly these
   * tools without an interactive permission prompt. The research step sets
   * ["WebSearch", "WebFetch"] so the model can gather live company data; the
   * synthesis steps (TAM/ICP/signals) leave it unset and additionally
   * disallow web tools so their output is a pure function of the prompt.
   */
  allowedTools?: string[];
  /** When set, passed as `--disallowedTools` to deny these tools. */
  disallowedTools?: string[];
}

export interface ClaudeCliResult {
  /** The model's answer text, extracted from the JSON envelope. */
  text: string;
  /** The full raw stdout (the JSON envelope, as text) for storage. */
  raw: string;
  /** Real cost when the envelope carries a usable cost field, else null. */
  cost_usd: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Candidate field names for the answer text, checked at the envelope's top
// level. "result" is the field named in the CLI's own --output-format json
// description; the rest are defensive fallbacks in case the live envelope
// nests differently than documented.
const TEXT_FIELD_CANDIDATES = ["result", "response", "output", "text", "content"];

export function extractResultText(parsed: unknown): string | null {
  if (typeof parsed === "string") return parsed;
  if (!isRecord(parsed)) return null;

  for (const field of TEXT_FIELD_CANDIDATES) {
    const value = parsed[field];
    if (typeof value === "string" && value.length > 0) return value;
  }

  // A message-array shape (e.g. { message: { content: [{text}] } }) is a
  // documented alternative Claude API response shape; check it before
  // giving up, since --output-format json could plausibly mirror it.
  const message = isRecord(parsed.message) ? parsed.message : null;
  const content = message?.content;
  if (Array.isArray(content)) {
    const firstText = content.find((c) => isRecord(c) && typeof c.text === "string") as
      | { text: string }
      | undefined;
    if (firstText) return firstText.text;
  }

  return null;
}

const COST_FIELD_CANDIDATES = ["total_cost_usd", "cost_usd", "cost"];

export function extractCostUsd(parsed: unknown): number | null {
  if (!isRecord(parsed)) return null;

  for (const field of COST_FIELD_CANDIDATES) {
    const value = parsed[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  const usage = isRecord(parsed.usage) ? parsed.usage : null;
  if (usage) {
    for (const field of COST_FIELD_CANDIDATES) {
      const value = usage[field];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }

  return null;
}

export function buildClaudeArgs(prompt: string, opts: ClaudeCliOpts): string[] {
  const args = ["-p", prompt, "--output-format", "json", "--model", opts.model];
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push("--allowedTools", opts.allowedTools.join(","));
  }
  if (opts.disallowedTools && opts.disallowedTools.length > 0) {
    args.push("--disallowedTools", opts.disallowedTools.join(","));
  }
  return args;
}

export async function runClaude(prompt: string, opts: ClaudeCliOpts): Promise<ClaudeCliResult> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      // Read lazily (not at module top level) so tests that mock db.js without
      // this export, but never invoke the CLI, still load claudeCli.ts.
      CLAUDE_CLI_PATH,
      buildClaudeArgs(prompt, opts),
      { timeout: opts.timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (err, out, stderr) => {
        if (err) {
          reject(
            new Error(
              `claude CLI invocation failed (model ${opts.model}): ${stderr?.trim() || err.message}`
            )
          );
          return;
        }
        resolve(out);
      }
    );
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`claude CLI --output-format json returned non-JSON stdout: ${stdout.slice(0, 500)}`);
  }

  const text = extractResultText(parsed);
  if (text === null) {
    throw new Error(
      `claude CLI JSON envelope had no recognizable result text field: ${stdout.slice(0, 500)}`
    );
  }

  return { text, raw: stdout, cost_usd: extractCostUsd(parsed) };
}
