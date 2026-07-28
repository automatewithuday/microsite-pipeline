// npx tsx scripts/inspect.ts               # list leads in the local DB
// npx tsx scripts/inspect.ts <lead-uuid>   # export + print one lead's report
//
// Exports the Clay-table-equivalent view of a lead: every stored step output
// as output/<leadId>.report.md, plus the full step-07 research text as
// output/<leadId>.research.md. Read-only against the pipeline state; safe to
// run at any time, including mid-pipeline.

import { fileURLToPath } from "node:url";
import type { LeadRow } from "../src/db.js";
import { buildLeadReport, extractResearchResponse } from "../src/pure/leadReport.js";
import { getStateBackend } from "../src/state/index.js";

const state = getStateBackend();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_LIMIT = 50;

function leadLabel(lead: LeadRow): string {
  const merged = (lead.company_data as { merged?: { name?: unknown } } | null | undefined)?.merged;
  const name =
    (merged && typeof merged.name === "string" && merged.name) ||
    (typeof lead.company === "string" && lead.company) ||
    "(no company)";
  const status = lead.step_status ?? {};
  const done = Object.values(status).filter((s) => s.state === "done").length;
  return `${lead.id}  ${name}  (${done}/${Object.keys(status).length} steps done)`;
}

async function listLeads(): Promise<void> {
  const leads = await state.listPending(LIST_LIMIT, () => true);
  if (leads.length === 0) {
    console.log("No leads in the local DB yet. Seed one with scripts/run.ts --lead-url ...");
    return;
  }
  console.log(`Leads (oldest first, max ${LIST_LIMIT}):\n`);
  for (const lead of leads) console.log(`  ${leadLabel(lead)}`);
  console.log("\nExport one with: npx tsx scripts/inspect.ts <lead-uuid>");
}

async function exportLead(id: string): Promise<void> {
  const lead = await state.getLead(id);
  if (!lead) {
    console.error(`Could not find lead ${id}`);
    process.exit(1);
  }

  const report = buildLeadReport(lead);
  const reportUrl = await state.writeArtifact(String(lead.id), "report.md", Buffer.from(report, "utf-8"));

  const research = extractResearchResponse(lead);
  const researchUrl = research
    ? await state.writeArtifact(String(lead.id), "research.md", Buffer.from(research, "utf-8"))
    : null;

  console.log(report);
  console.log("Exported:");
  console.log(`  report:   ${fileURLToPath(reportUrl)}`);
  if (researchUrl) console.log(`  research: ${fileURLToPath(researchUrl)}`);
  else console.log("  research: not exported (research step has not produced a response yet)");
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === undefined) {
    await listLeads();
    return;
  }
  if (!UUID_RE.test(arg)) {
    console.error(`"${arg}" is not a valid lead uuid. Run with no arguments to list leads.`);
    process.exit(1);
  }
  await exportLead(arg);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
