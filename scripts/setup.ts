// Interactive first-run setup. Walks through the switches, collects the
// keys you actually want, verifies each one against the real API, and writes
// .env for you.
//
// Deliberately does NOT import src/db.ts: it runs BEFORE .env exists, and
// db.ts fail-fasts at import time on a missing required key — exactly the
// situation this script exists to fix. Reads process.env directly with the
// same defaults db.ts uses.
//
// Non-interactive? Use scripts/init.ts instead: it copies the template and
// leaves the editing to you.

import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { renderEnv } from "../src/pure/envTemplate.js";
import { openLocalDb } from "../src/state/localDb.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(repoRoot, ".env");
const examplePath = path.join(repoRoot, ".env.example");

// ---------------------------------------------------------------------------
// Terminal helpers. Colors degrade to plain text when not a TTY or NO_COLOR is
// set, so piped output stays readable.
// ---------------------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
};

function heading(step: string, title: string): void {
  console.log(`\n${c.bold(`${step}  ${title}`)}`);
  console.log(c.dim("─".repeat(Math.min(60, `${step}  ${title}`.length + 8))));
}

// ---------------------------------------------------------------------------
// Key verification. Each probe makes the cheapest real call that proves the
// credential works, and reports a short reason on failure. A probe never
// throws: network flakiness must not abort setup, so it degrades to a warning
// and the user decides whether to keep the key anyway.
// ---------------------------------------------------------------------------

interface ProbeResult {
  ok: boolean;
  detail: string;
}

const TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// One-token message: the cheapest call that proves the key can actually run
// inference (a 401 from a revoked key surfaces here, not 10 minutes into a run).
async function probeAnthropic(key: string): Promise<ProbeResult> {
  try {
    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (res.ok) return { ok: true, detail: "key works" };
    if (res.status === 401) return { ok: false, detail: "rejected (401) — wrong or revoked key" };
    if (res.status === 429) return { ok: true, detail: "key valid, but rate-limited right now" };
    if (res.status === 400) {
      // A 400 still proves authentication passed; the model id may just differ.
      return { ok: true, detail: "key authenticates" };
    }
    return { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `could not reach the API (${(err as Error).message})` };
  }
}

async function probeApify(token: string): Promise<ProbeResult> {
  try {
    const res = await fetchWithTimeout(
      `https://api.apify.com/v2/users/me?token=${encodeURIComponent(token)}`
    );
    if (res.ok) return { ok: true, detail: "token works" };
    if (res.status === 401) return { ok: false, detail: "rejected (401) — wrong or revoked token" };
    return { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `could not reach the API (${(err as Error).message})` };
  }
}

async function probeFirecrawl(key: string): Promise<ProbeResult> {
  try {
    const res = await fetchWithTimeout("https://api.firecrawl.dev/v1/team/credit-usage", {
      headers: { authorization: `Bearer ${key}` },
    });
    if (res.ok) return { ok: true, detail: "key works" };
    if (res.status === 401 || res.status === 403)
      return { ok: false, detail: "rejected — wrong or revoked key" };
    return { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `could not reach the API (${(err as Error).message})` };
  }
}

async function probePerplexity(key: string): Promise<ProbeResult> {
  try {
    const res = await fetchWithTimeout("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "sonar",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (res.ok || res.status === 400) return { ok: true, detail: "key authenticates" };
    if (res.status === 401) return { ok: false, detail: "rejected (401) — wrong or revoked key" };
    return { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `could not reach the API (${(err as Error).message})` };
  }
}

// Providers with no cheap unauthenticated-safe probe endpoint. Format-checked
// only — we say so rather than implying a verification we didn't do.
const NO_PROBE = "saved (not verified — no cheap check available)";

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

// Raised when stdin closes (Ctrl-D, or a pipe running dry) so main() can exit
// cleanly instead of hanging. node:readline's question() never settles on EOF,
// so the close event has to be raced against it explicitly.
class InputClosedError extends Error {
  constructor() {
    super("stdin closed");
    this.name = "InputClosedError";
  }
}

// With a non-TTY stdin (a pipe, a heredoc) readline emits "close" as soon as
// the buffered input is drained — often while earlier answers are still
// queued. So "close" alone doesn't mean EOF: race it against the pending
// question and let a real answer win. Only a close with no answer behind it is
// treated as end-of-input.
async function question(rl: Interface, prompt: string): Promise<string> {
  let onClose!: () => void;
  const closed = new Promise<typeof EOF>((resolve) => {
    // setImmediate defers past the microtask queue, so a question() that was
    // already answered in this tick settles first and wins the race.
    onClose = () => setImmediate(() => resolve(EOF));
    rl.once("close", onClose);
  });
  try {
    const answer = await Promise.race([rl.question(prompt), closed]);
    if (answer === EOF) throw new InputClosedError();
    return answer;
  } finally {
    rl.off("close", onClose);
  }
}

const EOF = Symbol("eof");

async function ask(rl: Interface, question_: string, fallback = ""): Promise<string> {
  const suffix = fallback ? c.dim(` [${fallback}]`) : "";
  const answer = (await question(rl, `${question_}${suffix} `)).trim();
  return answer || fallback;
}

async function askYesNo(rl: Interface, prompt: string, defaultYes: boolean): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  for (;;) {
    const answer = (await question(rl, `${prompt} ${c.dim(`(${hint})`)} `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
    console.log(c.dim("  Please answer y or n."));
  }
}

async function askChoice(
  rl: Interface,
  prompt: string,
  options: Array<{ value: string; label: string }>,
  defaultValue: string
): Promise<string> {
  if (prompt) console.log(prompt);
  for (const [i, opt] of options.entries()) {
    const marker = opt.value === defaultValue ? c.dim(" (default)") : "";
    console.log(`  ${c.cyan(String(i + 1))}. ${opt.label}${marker}`);
  }
  for (;;) {
    const answer = (await question(rl, c.dim("  Choose a number: "))).trim();
    if (!answer) return defaultValue;
    const idx = Number(answer);
    if (Number.isInteger(idx) && idx >= 1 && idx <= options.length) return options[idx - 1]!.value;
    const byValue = options.find((o) => o.value === answer.toLowerCase());
    if (byValue) return byValue.value;
    console.log(c.dim(`  Enter 1-${options.length}.`));
  }
}

// Collect an optional provider key: offer to skip, then verify what was given.
// Returns "" when skipped, so the caller writes an empty value and the step
// skips cleanly at run time.
async function askKey(
  rl: Interface,
  opts: {
    name: string;
    what: string;
    where: string;
    probe?: (value: string) => Promise<ProbeResult>;
  }
): Promise<string> {
  console.log(`\n  ${c.bold(opts.name)} — ${opts.what}`);
  console.log(c.dim(`  Get one: ${opts.where}`));
  const value = (await question(rl, c.dim("  Paste the key (or press Enter to skip): "))).trim();
  if (!value) {
    console.log(c.dim("  Skipped — the steps needing it will skip cleanly."));
    return "";
  }
  if (!opts.probe) {
    console.log(c.dim(`  ${NO_PROBE}`));
    return value;
  }
  process.stdout.write(c.dim("  Verifying... "));
  const result = await opts.probe(value);
  console.log(result.ok ? c.green(result.detail) : c.red(result.detail));
  if (result.ok) return value;
  const keep = await askYesNo(rl, c.dim("  Keep it anyway?"), false);
  if (keep) return value;
  return askKey(rl, opts);
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(c.bold("\nMicrosite Pipeline — setup"));
  console.log(
    c.dim(
      "This asks a few questions and writes your .env.\n" +
        "Everything except the Anthropic key is optional; press Enter to skip any of them.\n" +
        "Keys are written to .env (gitignored) and never printed back."
    )
  );

  if (!existsSync(examplePath)) {
    console.log(c.red("\n.env.example is missing — cannot build a .env from it. Aborting."));
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (existsSync(envPath)) {
      console.log(c.yellow("\nA .env already exists."));
      const overwrite = await askYesNo(
        rl,
        "Overwrite it with the answers you're about to give?",
        false
      );
      if (!overwrite) {
        console.log("Left your .env untouched. Nothing else to do.");
        return;
      }
    }

    const values: Record<string, string> = {};

    // --- 1. LLM provider --------------------------------------------------
    heading("1/4", "How should the AI steps run?");
    const llmProvider = await askChoice(
      rl,
      "",
      [
        { value: "api", label: "Anthropic API — pay per call with your own API key." },
        { value: "claude_cli", label: "Claude CLI — use a local `claude` binary on a Claude subscription." },
      ],
      "api"
    );
    values.LLM_PROVIDER = llmProvider;

    if (llmProvider === "api") {
      console.log(c.dim("\n  This is the one key the pipeline can't run without."));
      for (;;) {
        const key = await askKey(rl, {
          name: "ANTHROPIC_API_KEY",
          what: "research, TAM, ICP segments, sales signals — the core of the deck",
          where: "https://console.anthropic.com/settings/keys",
          probe: probeAnthropic,
        });
        if (key) {
          values.ANTHROPIC_API_KEY = key;
          break;
        }
        console.log(
          c.yellow("  Without this key nothing renders. Add it now, or switch to the Claude CLI.")
        );
        const proceed = await askYesNo(rl, "  Continue without it and add it to .env later?", false);
        if (proceed) {
          values.ANTHROPIC_API_KEY = "";
          break;
        }
      }
    } else {
      console.log(
        c.dim("\n  Using the local `claude` binary. Make sure `claude` is on your PATH.")
      );
      values.ANTHROPIC_API_KEY = "";
    }

    // --- 2. Research backend ---------------------------------------------
    heading("2/4", "Which research backend?");
    const researchProvider = await askChoice(
      rl,
      "",
      [
        { value: "claude", label: "Claude — uses the key you just set. No extra signup." },
        { value: "parallel", label: "Parallel — needs a PARALLEL_API_KEY." },
        { value: "perplexity", label: "Perplexity — needs a PERPLEXITY_API_KEY." },
      ],
      "claude"
    );
    values.RESEARCH_PROVIDER = researchProvider;

    if (researchProvider === "parallel") {
      values.PARALLEL_API_KEY = await askKey(rl, {
        name: "PARALLEL_API_KEY",
        what: "the research step (07)",
        where: "https://platform.parallel.ai",
      });
    }
    if (researchProvider === "perplexity") {
      values.PERPLEXITY_API_KEY = await askKey(rl, {
        name: "PERPLEXITY_API_KEY",
        what: "the research step (07)",
        where: "https://www.perplexity.ai/settings/api",
        probe: probePerplexity,
      });
    }

    // --- 3. Optional enrichment ------------------------------------------
    heading("3/4", "Optional provider keys");
    console.log(
      c.dim(
        "Each one fills in more of the deck. Skip them all and you still get a\n" +
          "working Anthropic-only microsite — just a shorter one."
      )
    );
    const wantOptional = await askYesNo(rl, "\nAdd any optional keys now?", false);

    if (wantOptional) {
      values.DEEPLINE_API_KEY = await askKey(rl, {
        name: "DEEPLINE_API_KEY",
        what: "person + company enrichment, founders, SDR headcount (steps 01/02/06)",
        where: "https://code.deepline.com (account > API keys)",
      });
      values.APIFY_TOKEN = await askKey(rl, {
        name: "APIFY_TOKEN",
        what: "website traffic and Meta/Google/LinkedIn ad counts (steps 04/05)",
        where: "https://console.apify.com/settings/integrations",
        probe: probeApify,
      });
      if (values.APIFY_TOKEN) {
        console.log(
          c.dim(
            "\n  Apify actors: the Meta/Google/LinkedIn ad actors have defaults in\n" +
              "  .env.example. Traffic (step 04) needs an actor you pick from the store:\n" +
              "  https://apify.com/store"
          )
        );
        const similarweb = await ask(rl, "  APIFY_ACTOR_SIMILARWEB (optional):");
        if (similarweb) values.APIFY_ACTOR_SIMILARWEB = similarweb;
      }
      if (values.DEEPLINE_API_KEY || values.APIFY_TOKEN) {
        const adsRoute = await askChoice(
          rl,
          "\n  Traffic + ad counts (steps 04/05) can run through either provider.\n  Which route do you want?",
          [
            { value: "auto", label: "Auto — Apify when configured, Deepline as fallback. Recommended." },
            { value: "apify", label: "Apify only — never call Deepline for these steps." },
            { value: "deepline", label: "Deepline only — DataForSEO + Adyntel tools, no Apify actors needed." },
          ],
          "auto"
        );
        if (adsRoute !== "auto") values.ADS_TRAFFIC_PROVIDER = adsRoute;
      }
      values.FIRECRAWL_API_KEY = await askKey(rl, {
        name: "FIRECRAWL_API_KEY",
        what: "stronger CRM detection, brand colors, logo scraping",
        where: "https://www.firecrawl.dev/app/api-keys",
        probe: probeFirecrawl,
      });
      values.BRANDFETCH_API_KEY = await askKey(rl, {
        name: "BRANDFETCH_API_KEY",
        what: "cleaner logo lookup (step 09)",
        where: "https://developers.brandfetch.com",
      });
    } else {
      console.log(c.dim("Skipped — you can add them to .env any time."));
    }

    // --- 4. Write and prepare --------------------------------------------
    heading("4/4", "Writing your setup");

    const template = readFileSync(examplePath, "utf8");
    writeFileSync(envPath, renderEnv(template, values), { mode: 0o600 });
    console.log(`${c.green("✓")} Wrote .env ${c.dim("(gitignored, chmod 600)")}`);

    const outputDir = path.resolve(repoRoot, process.env.OUTPUT_DIR || "output");
    mkdirSync(outputDir, { recursive: true });
    console.log(`${c.green("✓")} Output directory ready ${c.dim(outputDir)}`);

    const dbPath = process.env.LOCAL_DB_PATH || "local.db";
    const db = openLocalDb(dbPath);
    db.close();
    console.log(`${c.green("✓")} Local database ready ${c.dim(path.resolve(repoRoot, dbPath))}`);

    // Chromium is required to print the PDF, and its absence is the most
    // common first-run failure — so check rather than assume.
    const chromiumReady = await hasChromium();
    if (!chromiumReady) {
      console.log(
        `${c.yellow("!")} Chromium not found — the PDF step needs it. Run:\n` +
          `  ${c.cyan("npx playwright install chromium chromium-headless-shell")}`
      );
    } else {
      console.log(`${c.green("✓")} Chromium available for PDF rendering`);
    }

    console.log(c.bold("\nYou're set up. Next:"));
    console.log(`  1. Confirm what will run:  ${c.cyan("npx tsx scripts/doctor.ts")}`);
    console.log(
      `  2. Generate a microsite:   ${c.cyan(
        'npx tsx scripts/run.ts --lead-url <linkedin> --name "<name>" --company <domain>'
      )}`
    );
    console.log(`  3. View it:                ${c.cyan("npx tsx scripts/serve.ts")}\n`);
  } finally {
    rl.close();
  }
}

async function hasChromium(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    const exe = chromium.executablePath();
    return !!exe && existsSync(exe);
  } catch {
    return false;
  }
}

main().catch((err) => {
  // Ctrl-C aborts the pending question; treat it as a deliberate cancel.
  if ((err as { code?: string }).code === "ABORT_ERR") {
    console.log("\nSetup cancelled. Nothing was written.");
    return;
  }
  // Stdin ran out mid-question — piped input, or Ctrl-D. Setup is interactive
  // by nature, so say what to use instead rather than failing opaquely.
  if (err instanceof InputClosedError) {
    console.log(
      c.yellow("\nInput ended before setup finished — nothing was written.") +
        "\nThis wizard needs an interactive terminal." +
        `\nFor a non-interactive setup use ${c.cyan("npx tsx scripts/init.ts")}, then edit .env.`
    );
    process.exitCode = 1;
    return;
  }
  console.error(c.red(`\nSetup failed: ${(err as Error).message}`));
  process.exitCode = 1;
});
