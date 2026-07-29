// Self-hosted renderer: orchestration + I/O. Reads the committed template,
// calls the pure builder, renders a 9-page PDF with Playwright, persists the
// artifacts via the state backend, and writes the rendered_html + render
// columns. Idempotent "done" skip, gate skip, and errors caught to markStep
// (a step error never crashes the batch).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { RENDER_STRICT, getStepState, type LeadRow } from "./db.js";
import type { StateBackend } from "./state/types.js";
import { renderGate, buildMicrositeHtml } from "./pure/microsite.js";
import { resolveDeckTemplate } from "./pure/deckTemplates.js";
import { loadProofLibrary } from "./proofLibrary.js";
import type { ProofLibrary } from "./pure/proofLibrary.js";

const here = dirname(fileURLToPath(import.meta.url));

// DECK_TEMPLATE is read at call time (not hoisted into db.ts) so tests and
// per-batch runs can vary it without re-importing the module graph.
function templatePath(name: string): string {
  return resolve(here, `../templates/${name}/index.html`);
}

// Launch headless Chromium, set the interpolated HTML, and print an A4
// landscape PDF (printBackground so the deck's brand fills render). The
// 120s per-step timeout applies at the pipeline level.
export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, landscape: true });
    return pdf as Buffer;
  } finally {
    await browser.close();
  }
}

/**
 * Runs the render step for one lead row: idempotent skip when already "done"
 * (unless forced), gate skip (markStep skipped, never an error), else build
 * the HTML, render the PDF, persist the artifacts, and write the rendered_html + render
 * columns. Any thrown error is caught and recorded as a step error, never
 * thrown past the row. Takes (lead, persistence, opts).
 */
export async function applyRender(
  lead: LeadRow,
  persistence: StateBackend,
  opts: { force?: boolean } = {}
): Promise<void> {
  const leadId = String(lead.id);

  if (getStepState(lead, "render") === "done" && !opts.force) return;

  const gate = renderGate(lead, RENDER_STRICT);
  if (!gate.ok) {
    await persistence.markStep(leadId, "render", { state: "skipped", error: gate.reason });
    return;
  }

  try {
    const templateName = resolveDeckTemplate(lead, process.env.DECK_TEMPLATE);
    const tPath = templatePath(templateName);
    const templateHtml = await readFile(tPath, "utf8").catch(() => {
      throw new Error(
        `deck template "${templateName}" missing at ${tPath}. Run scripts/build-deck-template.ts ${templateName} to regenerate it.`
      );
    });

    // Library failures degrade the deck (Work/Plan pages drop) instead of
    // erroring the whole render step — the library is optional content.
    let library: ProofLibrary | null = null;
    try {
      library = loadProofLibrary();
    } catch {
      library = null;
    }
    const html = buildMicrositeHtml(lead, templateHtml, library);

    // Write the artifacts FIRST, so we never persist rendered_html for a lead
    // whose PDF failed (which would make /d/<id> serve a page while
    // /d/<id>.pdf 404s). Both columns are written only on full success.
    const pdf = await renderPdf(html);

    const pdfUrl = await persistence.writeArtifact(leadId, "pdf", pdf);
    const pageUrl = await persistence.writeArtifact(leadId, "html", Buffer.from(html, "utf8"));

    await persistence.writeColumn(leadId, "rendered_html", html);
    await persistence.writeColumn(leadId, "render", { pdfUrl, pageUrl });
    await persistence.markStep(leadId, "render", {
      state: "done",
      provider: "self-hosted",
      cost_usd: 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await persistence.markStep(leadId, "render", { state: "error", error: message });
  }
}
