// Skim queue + deploy for follow-up decks.
//
//   npx tsx scripts/followup.ts list
//   npx tsx scripts/followup.ts preview <leadId>
//   npx tsx scripts/followup.ts notes <leadId> "<call notes>"
//   npx tsx scripts/followup.ts regenerate <leadId> [--steer "<note>"]
//   npx tsx scripts/followup.ts approve <leadId> [--dry-run]
//
// Nothing gets a live URL except through `approve`.

import { assertRequiredEnv, getStepState, type LeadRow } from "../src/db.js";
import { applyFollowupRender } from "../src/followupRender.js";
import { deployFollowup } from "../src/netlifyDeploy.js";
import { runStepsForLead } from "../src/pipeline.js";
import { loadProofLibrary } from "../src/proofLibrary.js";
import { buildFollowupSkim, readCompanyName } from "../src/pure/followup.js";
import { getStateBackend } from "../src/state/index.js";
import { STEPS } from "../src/steps/index.js";

const state = getStateBackend();

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage:",
      "  npx tsx scripts/followup.ts list",
      "  npx tsx scripts/followup.ts preview <leadId>",
      '  npx tsx scripts/followup.ts notes <leadId> "<call notes>"',
      '  npx tsx scripts/followup.ts regenerate <leadId> [--steer "<note>"]',
      "  npx tsx scripts/followup.ts approve <leadId> [--dry-run]",
    ].join("\n")
  );
  process.exit(1);
}

async function getLeadOrDie(id: string): Promise<LeadRow> {
  const lead = await state.getLead(id);
  if (!lead) {
    console.error(`No lead found with id ${id}`);
    process.exit(1);
  }
  return lead;
}

function deployRecord(lead: LeadRow): { url?: string; site_id?: string } {
  const d = lead.followup_deploy;
  return d && typeof d === "object" ? (d as { url?: string; site_id?: string }) : {};
}

async function cmdList(): Promise<void> {
  const leads = await state.listPending(500, () => true);
  const drafts: string[] = [];
  const deployed: string[] = [];
  const failed: string[] = [];
  for (const lead of leads) {
    const renderState = getStepState(lead, "followup_render");
    if (renderState !== "done") continue;
    const name = readCompanyName(lead) || String(lead.linkedin_url ?? lead.id);
    const line = `  ${lead.id}  ${name}`;
    const deployState = getStepState(lead, "followup_deploy");
    if (deployState === "done") deployed.push(`${line}  ${deployRecord(lead).url ?? ""}`);
    else if (deployState === "error")
      failed.push(`${line}  (deploy failed: ${lead.step_status?.followup_deploy?.error ?? "?"})`);
    else drafts.push(line);
  }
  console.log(`Drafts awaiting review (${drafts.length}):`);
  console.log(drafts.join("\n") || "  (none)");
  console.log(`\nDeployed (${deployed.length}):`);
  console.log(deployed.join("\n") || "  (none)");
  if (failed.length) {
    console.log(`\nDeploy failed — re-run approve (${failed.length}):`);
    console.log(failed.join("\n"));
  }
}

async function cmdPreview(id: string): Promise<void> {
  const lead = await getLeadOrDie(id);
  const library = loadProofLibrary();
  console.log(buildFollowupSkim(lead, library));
  const followup = lead.followup as { pageUrl?: string } | null | undefined;
  if (followup?.pageUrl) console.log(`Full page: ${followup.pageUrl}`);
  else console.log("No rendered draft yet — run scripts/run.ts for this lead first.");
}

async function cmdNotes(id: string, notes: string): Promise<void> {
  await getLeadOrDie(id);
  await state.writeColumn(id, "call_notes", notes);
  console.log(`Call notes saved. Regenerate to fold them in:\n  npx tsx scripts/followup.ts regenerate ${id}`);
}

async function cmdRegenerate(id: string, steer?: string): Promise<void> {
  assertRequiredEnv();
  if (steer) process.env.FOLLOWUP_STEER = steer;
  const lead = await getLeadOrDie(id);
  await runStepsForLead(lead, STEPS, state, { force: "followup_narrative" });
  await applyFollowupRender(await getLeadOrDie(id), state, { force: true });
  delete process.env.FOLLOWUP_STEER;
  const done = await getLeadOrDie(id);
  const narrativeState = getStepState(done, "followup_narrative");
  if (narrativeState !== "done") {
    console.error(
      `Regeneration failed: ${done.step_status?.followup_narrative?.error ?? "see step_status"}`
    );
    process.exit(1);
  }
  console.log("Regenerated. Preview:\n");
  await cmdPreview(id);
}

async function cmdApprove(id: string, dryRun: boolean): Promise<void> {
  const lead = await getLeadOrDie(id);
  if (getStepState(lead, "followup_render") !== "done") {
    console.error("This lead has no rendered follow-up draft (followup_render is not done).");
    process.exit(1);
  }
  const html = typeof lead.followup_html === "string" ? lead.followup_html : "";
  if (!html) {
    console.error("followup_html column is empty — regenerate first.");
    process.exit(1);
  }
  const company = readCompanyName(lead);
  const existing = deployRecord(lead);

  const outcomeOpts: { siteId?: string; dryRun?: boolean } = { dryRun };
  if (existing.site_id) outcomeOpts.siteId = existing.site_id;

  try {
    const outcome = await deployFollowup(html, company, outcomeOpts);
    if (outcome.dryRun) {
      console.log("Dry run — would execute:");
      for (const step of outcome.plan) console.log(`  - ${step}`);
      return;
    }
    await state.writeColumn(id, "followup_deploy", {
      url: outcome.url,
      site_id: outcome.siteId,
      slug: outcome.slug,
      at: new Date().toISOString(),
    });
    await state.markStep(id, "followup_deploy", { state: "done", provider: "netlify", cost_usd: 0 });
    console.log(`Deployed: ${outcome.url}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await state.markStep(id, "followup_deploy", { state: "error", error: message });
    console.error(`Deploy failed (recorded, re-run approve to retry): ${message}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "list":
      return cmdList();
    case "preview":
      if (!rest[0]) usage("preview requires a lead id");
      return cmdPreview(rest[0]);
    case "notes":
      if (!rest[0] || !rest[1]) usage("notes requires a lead id and a quoted notes string");
      return cmdNotes(rest[0], rest[1]);
    case "regenerate": {
      if (!rest[0]) usage("regenerate requires a lead id");
      const steerIdx = rest.indexOf("--steer");
      const steer = steerIdx !== -1 ? rest[steerIdx + 1] : undefined;
      return cmdRegenerate(rest[0], steer);
    }
    case "approve":
      if (!rest[0]) usage("approve requires a lead id");
      return cmdApprove(rest[0], rest.includes("--dry-run"));
    default:
      usage(command ? `unknown command "${command}"` : "no command given");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
