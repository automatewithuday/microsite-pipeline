// Follow-up render post-pass: reads the committed template + proof library,
// builds the page HTML and the reviewer skim, persists both artifacts, and
// writes the followup_html + followup columns. Mirrors render.ts semantics:
// idempotent "done" skip, gate skip, errors caught to markStep. No PDF.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getStepState, type LeadRow } from "./db.js";
import { loadProofLibrary } from "./proofLibrary.js";
import type { StateBackend } from "./state/types.js";
import { buildFollowupHtml, buildFollowupSkim, followupRenderGate } from "./pure/followup.js";

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(here, "../templates/followup/index.html");

export async function applyFollowupRender(
  lead: LeadRow,
  persistence: StateBackend,
  opts: { force?: boolean } = {}
): Promise<void> {
  const leadId = String(lead.id);

  if (getStepState(lead, "followup_render") === "done" && !opts.force) return;

  const gate = followupRenderGate(lead);
  if (!gate.ok) {
    await persistence.markStep(leadId, "followup_render", { state: "skipped", error: gate.reason });
    return;
  }

  try {
    const templateHtml = await readFile(TEMPLATE_PATH, "utf8").catch(() => {
      throw new Error(`followup template missing at ${TEMPLATE_PATH}`);
    });
    const library = loadProofLibrary();

    const html = buildFollowupHtml(lead, library, templateHtml);
    const skim = buildFollowupSkim(lead, library);

    const pageUrl = await persistence.writeArtifact(leadId, "followup.html", Buffer.from(html, "utf8"));
    const skimUrl = await persistence.writeArtifact(leadId, "followup.md", Buffer.from(skim, "utf8"));

    await persistence.writeColumn(leadId, "followup_html", html);
    await persistence.writeColumn(leadId, "followup", { pageUrl, skimUrl });
    await persistence.markStep(leadId, "followup_render", {
      state: "done",
      provider: "self-hosted",
      cost_usd: 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await persistence.markStep(leadId, "followup_render", { state: "error", error: message });
  }
}
