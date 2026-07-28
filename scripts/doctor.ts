// Pre-flight check: what will run with the current .env, and is the local
// state store writable. Never prints secret values, only SET/EMPTY.
//
// Deliberately does NOT import src/db.ts or the steps: db.ts fail-fasts at
// import time when a required var is missing, which is exactly the situation
// doctor needs to diagnose. It reads process.env directly with the same
// defaults db.ts uses.

import "dotenv/config";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

function isSet(name: string): boolean {
  return !!process.env[name] && process.env[name]!.length > 0;
}

const LLM_PROVIDER = process.env.LLM_PROVIDER || "api";
const RESEARCH_PROVIDER = process.env.RESEARCH_PROVIDER || "claude";
const ADS_TRAFFIC_PROVIDER = process.env.ADS_TRAFFIC_PROVIDER || "auto";

// Required set, mode-dependent (mirrors src/db.ts).
function requiredVars(): string[] {
  const req: string[] = [];
  if (LLM_PROVIDER === "api") req.push("ANTHROPIC_API_KEY");
  if (RESEARCH_PROVIDER === "parallel") req.push("PARALLEL_API_KEY");
  if (RESEARCH_PROVIDER === "perplexity") req.push("PERPLEXITY_API_KEY");
  return req;
}

// Whether the LLM steps (research/tam/icp/signals) can run at all.
function llmReady(): boolean {
  return LLM_PROVIDER === "claude_cli" || isSet("ANTHROPIC_API_KEY");
}

function researchReady(): { ok: boolean; why: string } {
  if (RESEARCH_PROVIDER === "parallel")
    return { ok: isSet("PARALLEL_API_KEY"), why: "PARALLEL_API_KEY" };
  if (RESEARCH_PROVIDER === "perplexity")
    return { ok: isSet("PERPLEXITY_API_KEY"), why: "PERPLEXITY_API_KEY" };
  return { ok: llmReady(), why: LLM_PROVIDER === "api" ? "ANTHROPIC_API_KEY" : "claude CLI" };
}

// Per-step run plan: each entry decides RUN/SKIP from present keys.
function stepPlan(): Array<{ step: string; run: boolean; note: string }> {
  const deepline = isSet("DEEPLINE_API_KEY");
  const apify = isSet("APIFY_TOKEN");
  const firecrawl = isSet("FIRECRAWL_API_KEY");
  const brandfetch = isSet("BRANDFETCH_API_KEY");
  const research = researchReady();

  const actor = (name: string) => apify && isSet(name);

  // One 04/05 row honoring ADS_TRAFFIC_PROVIDER: "deepline" ignores Apify,
  // "apify" ignores Deepline, "auto" is Apify-with-Deepline-fallback.
  const adsRow = (label: string, actorVar: string, deeplineTool: string) => {
    const viaApify = actor(actorVar);
    if (ADS_TRAFFIC_PROVIDER === "deepline") {
      return { step: label, run: deepline, note: deepline ? `Deepline (${deeplineTool})` : "ADS_TRAFFIC_PROVIDER=deepline needs DEEPLINE_API_KEY" };
    }
    if (ADS_TRAFFIC_PROVIDER === "apify") {
      return { step: label, run: viaApify, note: viaApify ? "Apify" : `needs APIFY_TOKEN + ${actorVar}` };
    }
    return {
      step: label,
      run: viaApify || deepline,
      note: viaApify ? (deepline ? "Apify, Deepline fallback" : "Apify") : deepline ? `Deepline (${deeplineTool})` : `needs APIFY_TOKEN + ${actorVar} or DEEPLINE_API_KEY`,
    };
  };

  const plan: Array<{ step: string; run: boolean; note: string }> = [
    { step: "person (01)", run: deepline, note: deepline ? "Deepline" : "needs DEEPLINE_API_KEY" },
    { step: "company (02)", run: deepline, note: deepline ? "Deepline" : "needs DEEPLINE_API_KEY (or a seeded --company domain)" },
    { step: "crm (03)", run: true, note: firecrawl ? "plain fetch + Firecrawl fallback" : "plain fetch only" },
    adsRow("traffic (04)", "APIFY_ACTOR_SIMILARWEB", "DataForSEO"),
    adsRow("ads_meta (05)", "APIFY_ACTOR_META_ADS", "Adyntel"),
    adsRow("ads_google (05)", "APIFY_ACTOR_GOOGLE_ADS", "Adyntel"),
    adsRow("ads_linkedin (05)", "APIFY_ACTOR_LINKEDIN_ADS", "Adyntel"),
    { step: "founders (06)", run: deepline, note: deepline ? "Deepline" : "needs DEEPLINE_API_KEY" },
    { step: "sdr (06)", run: deepline, note: deepline ? "Deepline" : "needs DEEPLINE_API_KEY" },
    { step: "research (07)", run: research.ok, note: research.ok ? `via ${RESEARCH_PROVIDER}` : `needs ${research.why}` },
    { step: "brand_colors (08)", run: true, note: firecrawl ? "plain fetch + Firecrawl fallback" : "plain fetch only" },
    { step: "logo (09)", run: true, note: brandfetch ? "Brandfetch + fallback" : firecrawl ? "plain fetch + Firecrawl fallback" : "plain fetch only" },
    { step: "tam (10)", run: llmReady(), note: llmReady() ? `LLM (${LLM_PROVIDER})` : "needs ANTHROPIC_API_KEY" },
    { step: "icp_segments (11)", run: llmReady(), note: llmReady() ? `LLM (${LLM_PROVIDER})` : "needs ANTHROPIC_API_KEY" },
    { step: "sales_signals (12)", run: llmReady(), note: llmReady() ? `LLM (${LLM_PROVIDER})` : "needs ANTHROPIC_API_KEY" },
  ];
  return plan;
}

async function checkBackend(): Promise<{ ok: boolean; message: string }> {
  const dbPath = path.resolve(process.cwd(), process.env.LOCAL_DB_PATH || "local.db");
  try {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    const probe = `${dbPath}.doctor-probe`;
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    return { ok: true, message: `local: SQLite path writable (${dbPath})` };
  } catch (err) {
    return { ok: false, message: `local: cannot write near ${dbPath}: ${(err as Error).message}` };
  }
}

async function main(): Promise<void> {
  console.log(`Switches:  LLM_PROVIDER=${LLM_PROVIDER}  RESEARCH_PROVIDER=${RESEARCH_PROVIDER}  ADS_TRAFFIC_PROVIDER=${ADS_TRAFFIC_PROVIDER}\n`);

  const required = requiredVars();
  const missing = required.filter((v) => !isSet(v));
  console.log("Required (for the current switches):");
  if (required.length === 0) console.log("  (none)");
  for (const v of required) console.log(`  ${v.padEnd(28)} ${isSet(v) ? "SET" : "EMPTY  <-- missing"}`);

  console.log("\nStep plan (what runs with the current keys):");
  const plan = stepPlan();
  const width = Math.max(...plan.map((p) => p.step.length));
  for (const p of plan) {
    console.log(`  ${p.step.padEnd(width)}  ${p.run ? "RUN " : "SKIP"}  ${p.note}`);
  }

  const backend = await checkBackend().catch((err) => ({ ok: false, message: (err as Error).message }));
  console.log(`\nState backend: ${backend.ok ? "OK" : "FAIL"} — ${backend.message}`);

  const renders = plan.find((p) => p.step.startsWith("tam"))?.run &&
    plan.find((p) => p.step.startsWith("icp"))?.run &&
    plan.find((p) => p.step.startsWith("sales_signals"))?.run &&
    plan.find((p) => p.step.startsWith("research"))?.run;
  console.log(
    renders
      ? "\nRender: the core AI steps can run, so a lead can produce a microsite."
      : "\nRender: the core AI steps (research/tam/icp/signals) can't all run yet — no deck until they can."
  );

  console.log("");
  if (missing.length > 0) {
    console.log(`RESULT: FAIL. Missing required var(s): ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (!backend.ok) {
    console.log("RESULT: FAIL. State backend not ready (see above).");
    process.exitCode = 1;
    return;
  }
  console.log("RESULT: OK.");
}

main();
