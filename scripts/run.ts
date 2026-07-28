// npx tsx scripts/run.ts --batch 50                          # process pending rows
// npx tsx scripts/run.ts --lead <uuid>                        # one existing row end to end
// npx tsx scripts/run.ts --lead <uuid> --force --step <name>  # force one step
// npx tsx scripts/run.ts --lead-url <linkedin> --name "<name>" --company <domain>
//                                                             # seed + run one ad-hoc lead (no CSV)

import { DEEPLINE_API_KEY, type LeadRow } from "../src/db.js";
import { applyDerived } from "../src/derivedRoutine.js";
import { normalizeDomain, toHttpUrl } from "../src/pure/normalize.js";
import { applyRender } from "../src/render.js";
import {
  isLeadPending,
  printCostSummary,
  runBatch,
  runStepsForLead,
  type RunOptions,
} from "../src/pipeline.js";
import { getStateBackend, type SeedLead } from "../src/state/index.js";
import { STEPS } from "../src/steps/index.js";

const state = getStateBackend();

const POST_PASS_STEP_NAMES = ["derived", "render"];
const VALID_STEP_NAMES = [...STEPS.map((s) => s.name), ...POST_PASS_STEP_NAMES];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function printUsageAndExit(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage:",
      "  npx tsx scripts/run.ts --batch <N>",
      "  npx tsx scripts/run.ts --lead <uuid>",
      "  npx tsx scripts/run.ts --lead <uuid> --force --step <name>",
      '  npx tsx scripts/run.ts --lead-url <linkedin> --name "<name>" --company <domain>',
      "",
      `Valid step names: ${VALID_STEP_NAMES.join(", ")}`,
    ].join("\n")
  );
  process.exit(1);
}

interface ParsedArgs {
  batch?: string;
  lead?: string;
  force?: boolean;
  step?: string;
  leadUrl?: string;
  name?: string;
  company?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--batch": args.batch = argv[++i]; break;
      case "--lead": args.lead = argv[++i]; break;
      case "--force": args.force = true; break;
      case "--step": args.step = argv[++i]; break;
      case "--lead-url": args.leadUrl = argv[++i]; break;
      case "--name": args.name = argv[++i]; break;
      case "--company": args.company = argv[++i]; break;
      default: printUsageAndExit(`unknown argument "${arg}"`);
    }
  }
  return args;
}

async function fetchLeadById(id: string): Promise<LeadRow> {
  const lead = await state.getLead(id);
  if (!lead) throw new Error(`Could not find lead ${id}`);
  return lead;
}

async function fetchPendingBatch(limit: number): Promise<LeadRow[]> {
  return state.listPending(limit, (lead) => isLeadPending(lead, STEPS));
}

// Title-cases a domain's base label so an ANTHROPIC-only run has a readable
// company name ("smart-lead.ai" -> "Smart Lead") when Deepline isn't there to
// return the real one. Not fabricated data — it's a formatting of the domain
// the user supplied.
function deriveCompanyName(domain: string): string {
  const base = domain.split(".")[0] ?? domain;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

// Seeds one ad-hoc lead and returns its id. When Deepline is absent and a domain
// was given, pre-seeds company_data.merged so the domain-keyed steps (03/07/08/09)
// still run — the ANTHROPIC-only path.
async function seedAdHocLead(linkedinUrl: string, name?: string, company?: string): Promise<string> {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const seed: SeedLead = {
    linkedin_url: linkedinUrl,
    first_name: parts[0] ?? null,
    last_name: parts.length > 1 ? parts.slice(1).join(" ") : null,
    company: company ?? null,
  };

  if (!DEEPLINE_API_KEY && company && DOMAIN_LIKE.test(company)) {
    const domain = normalizeDomain(company);
    if (domain) {
      seed.company_data = {
        merged: { name: deriveCompanyName(domain), domain, website: toHttpUrl(company) ?? domain },
      };
    }
  }

  await state.upsertLeads([seed]);
  const lead = await state.getLeadByLinkedinUrl(linkedinUrl);
  if (!lead) throw new Error(`failed to seed lead for ${linkedinUrl}`);
  return String(lead.id);
}

// Runs the DAG + derived + render for one lead id, refetching between passes so
// each sees the columns the prior pass wrote. Prints where the deck landed.
async function processLead(id: string, forceStep?: string): Promise<void> {
  const lead = await fetchLeadById(id);
  const options: RunOptions = forceStep ? { force: forceStep } : {};
  const costs = await runStepsForLead(lead, STEPS, state, options);
  printCostSummary(costs);

  await applyDerived(await fetchLeadById(id), state);
  await applyRender(await fetchLeadById(id), state, { force: forceStep === "render" });

  const done = await fetchLeadById(id);
  const render = done.render as { pageUrl?: string; pdfUrl?: string } | null | undefined;
  if (render?.pageUrl || render?.pdfUrl) {
    console.log("\nMicrosite rendered:");
    if (render.pageUrl) console.log(`  page: ${render.pageUrl}`);
    if (render.pdfUrl) console.log(`  pdf:  ${render.pdfUrl}`);
    console.log("  (view in a browser: `npx tsx scripts/serve.ts`)");
  } else {
    const reason = done.step_status?.render?.error ?? "see step_status";
    console.log(`\nNo microsite rendered: ${reason}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) printUsageAndExit("no arguments given");

  const args = parseArgs(argv);

  if (args.force && !args.step) printUsageAndExit("--force requires --step <name>");
  if (args.step && !args.force) printUsageAndExit("--step requires --force");
  if ((args.force || args.step) && !args.lead) {
    printUsageAndExit("--force --step requires --lead <uuid>");
  }
  if (args.step && !VALID_STEP_NAMES.includes(args.step)) {
    printUsageAndExit(`unknown step "${args.step}". Valid step names: ${VALID_STEP_NAMES.join(", ")}`);
  }

  const modes = [args.leadUrl !== undefined, args.lead !== undefined, args.batch !== undefined].filter(
    Boolean
  ).length;
  if (modes > 1) printUsageAndExit("--lead-url, --lead, and --batch are mutually exclusive");

  if (args.leadUrl !== undefined) {
    if (!args.leadUrl) printUsageAndExit("--lead-url requires a LinkedIn URL");
    const id = await seedAdHocLead(args.leadUrl, args.name, args.company);
    console.log(`Seeded lead ${id}. Running end to end...\n`);
    await processLead(id);
    return;
  }

  if (args.lead !== undefined) {
    if (!UUID_RE.test(args.lead)) printUsageAndExit(`"${args.lead}" is not a valid lead uuid`);
    await processLead(args.lead, args.force && args.step ? args.step : undefined);
    return;
  }

  if (args.batch !== undefined) {
    const batchSize = Number(args.batch);
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      printUsageAndExit(`--batch requires a positive integer, got "${args.batch}"`);
    }

    const leads = await fetchPendingBatch(batchSize);
    console.log(`Processing ${leads.length} lead(s)...`);
    await runBatch(leads, STEPS, state, { concurrency: 5 });

    for (const lead of leads) {
      await applyDerived(await fetchLeadById(String(lead.id)), state);
      await applyRender(await fetchLeadById(String(lead.id)), state, {});
    }
    return;
  }

  printUsageAndExit("expected --batch <N>, --lead <uuid>, or --lead-url <linkedin>");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
