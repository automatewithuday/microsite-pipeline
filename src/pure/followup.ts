// Pure builders for the follow-up deck: render gate, slug, skim file.
// buildFollowupHtml lives here too (added with the template). No I/O.
// groundedIn citations appear ONLY in the skim, never on the page.

import type { LeadRow } from "../db.js";
import { followupNarrativeSchema, type FollowupNarrative } from "./aiSchemas.js";
import type { ProofLibrary } from "./proofLibrary.js";
import {
  escapeHtml,
  pickReadableAccent,
  pickThemedLogoUrl,
  removeSlot,
  type RenderGateResult,
} from "./microsite.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readCompanyName(lead: LeadRow): string {
  const companyData = lead.company_data as { merged?: { name?: unknown } } | null | undefined;
  const merged = isRecord(companyData?.merged) ? companyData.merged : undefined;
  const name = typeof merged?.name === "string" && merged.name ? merged.name : null;
  return name ?? (typeof lead.company === "string" ? lead.company : "");
}

/** Validated narrative off the lead row, or null when absent/invalid. */
export function readNarrative(lead: LeadRow): FollowupNarrative | null {
  const parsed = followupNarrativeSchema.safeParse(lead.followup_narrative);
  return parsed.success ? parsed.data : null;
}

export function followupRenderGate(lead: LeadRow): RenderGateResult {
  if (!lead.followup_narrative) {
    return { ok: false, reason: "followup_narrative column is missing" };
  }
  if (!readNarrative(lead)) {
    return { ok: false, reason: "followup_narrative column does not validate" };
  }
  if (!readCompanyName(lead)) {
    return { ok: false, reason: "no company name available" };
  }
  return { ok: true };
}

/**
 * Deterministic Netlify site name: kebab-cased company + "-growth-plan",
 * with "-2"/"-3"... appended on collision retries (attempt 1 -> "-2").
 */
export function followupSlug(companyName: string, attempt = 0): string {
  const base = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = attempt > 0 ? `-${attempt + 1}` : "";
  return `${base}-growth-plan${suffix}`;
}

/**
 * The ~30-line reviewer skim: every claim with its grounding, every pick with
 * its relevance, so approve/regenerate takes seconds.
 */
export function buildFollowupSkim(lead: LeadRow, library: ProofLibrary): string {
  const n = readNarrative(lead);
  const company = readCompanyName(lead);
  if (!n) return `# ${company}\n\nNo valid followup narrative.\n`;

  const caseById = new Map(library.caseStudies.map((c) => [c.id, c]));
  const playById = new Map(library.plays.map((p) => [p.id, p]));

  const lines: string[] = [
    `# Follow-up draft: ${company}`,
    ``,
    `Slug: ${followupSlug(company)}`,
    ``,
    `## Diagnosis (claims + grounding)`,
    ...n.diagnosis.map((d) => `- **${d.title}** — ${d.body}\n  - grounded in: ${d.groundedIn}`),
    ``,
    `## Business reading`,
    ...n.businessReading.map((p) => `- ${p}`),
    ``,
    `## Fit`,
    `- ${n.fit}`,
    ``,
    `## Playbook`,
    ...n.playbook.map((p, i) => `${i + 1}. **${p.title}** — ${p.body}`),
    ``,
    `## Case study picks`,
    ...n.caseStudyPicks.map((p) => `- ${caseById.get(p.id)?.client ?? p.id}: ${p.relevance}`),
    ``,
    `## Play picks`,
    ...n.playPicks.map((p) => `- ${playById.get(p.id)?.name ?? p.id}: ${p.relevance}`),
    ``,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------
// Page builder. The template owns layout and styling; this emits only the
// fixed .fu-* markup shapes for repeating content, always escaped. Library
// metric strings are inserted verbatim (escaped, never reworded).
// ---------------------------------------------------------------------

const e = escapeHtml;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function metricsHtml(metrics: { value: string; label: string }[]): string {
  if (metrics.length === 0) return "";
  const items = metrics
    .map(
      (m) =>
        `<div class="fu-metric"><span class="fu-metric-value">${e(m.value)}</span><span class="fu-metric-label">${e(m.label)}</span></div>`
    )
    .join("");
  return `<div class="fu-metrics">${items}</div>`;
}

export function buildFollowupHtml(lead: LeadRow, library: ProofLibrary, templateHtml: string): string {
  const n = readNarrative(lead);
  if (!n) throw new Error("buildFollowupHtml: followup_narrative does not validate");
  const company = readCompanyName(lead);

  const brandColors = isRecord(lead.brand_colors) ? lead.brand_colors : {};
  const primary = typeof brandColors.primary === "string" ? brandColors.primary : "";
  const secondary = typeof brandColors.secondary === "string" ? brandColors.secondary : "";
  const accent = pickReadableAccent(primary, secondary);
  const logoUrl = pickThemedLogoUrl(isRecord(lead.logo) ? lead.logo : {}, null);

  const caseById = new Map(library.caseStudies.map((c) => [c.id, c]));
  const playById = new Map(library.plays.map((p) => [p.id, p]));

  const diagnosisItems = n.diagnosis
    .map(
      (d) =>
        `<div class="fu-item"><h3 class="fu-item-title">${e(d.title)}</h3><p class="fu-item-body">${e(d.body)}</p></div>`
    )
    .join("\n");

  const readingParas = n.businessReading.map((p) => `<p class="fu-para">${e(p)}</p>`).join("\n");

  const playbookItems = n.playbook
    .map(
      (p, i) =>
        `<div class="fu-step"><span class="fu-step-num">${pad2(i + 1)}</span><div><h3 class="fu-item-title">${e(p.title)}</h3><p class="fu-item-body">${e(p.body)}</p></div></div>`
    )
    .join("\n");

  const caseItems = n.caseStudyPicks
    .map((pick) => {
      const c = caseById.get(pick.id);
      if (!c) return "";
      return [
        `<div class="fu-case">`,
        `<h3 class="fu-case-client">${e(c.client)}</h3>`,
        `<p class="fu-relevance">${e(pick.relevance)}</p>`,
        `<p class="fu-item-body"><strong>Problem.</strong> ${e(c.problem)}</p>`,
        `<p class="fu-item-body"><strong>What was done.</strong> ${e(c.approach)}</p>`,
        metricsHtml(c.metrics),
        `</div>`,
      ].join("");
    })
    .join("\n");

  const playItems = n.playPicks
    .map((pick) => {
      const p = playById.get(pick.id);
      if (!p) return "";
      const steps = p.steps.map((s) => `<li>${e(s)}</li>`).join("");
      return `<div class="fu-item"><h3 class="fu-item-title">${e(p.name)}</h3><p class="fu-relevance">${e(pick.relevance)}</p><ul class="fu-list">${steps}</ul></div>`;
    })
    .join("\n");

  const platformItems = library.platforms
    .map((p) => {
      const name = p.link ? `<a href="${e(p.link)}">${e(p.name)}</a>` : e(p.name);
      return `<div class="fu-item"><h3 class="fu-item-title">${name}</h3><p class="fu-item-body">${e(p.description)}</p>${metricsHtml(p.metrics)}</div>`;
    })
    .join("\n");

  const planItems = library.plan30day
    .map((phase, i) => {
      const items = phase.deliverables.map((d) => `<li>${e(d)}</li>`).join("");
      return `<div class="fu-step"><span class="fu-step-num">${pad2(i + 1)}</span><div><h3 class="fu-item-title">${e(phase.title)}</h3><ul class="fu-list">${items}</ul></div></div>`;
    })
    .join("\n");

  let html = templateHtml;
  if (!logoUrl) html = removeSlot(html, "logo");

  const replacements: Array<[string, string]> = [
    ["[LOGO_URL]", e(logoUrl)],
    ["[Company]", e(company)],
    ["[POSITIONING]", e(library.profile.positioning)],
    ["[LOCATION_LINE]", e(library.profile.locationLine)],
    ["[CAL_URL]", e(library.profile.calUrl)],
    ["[FIT]", e(n.fit)],
    ["[DIAGNOSIS_ITEMS]", diagnosisItems],
    ["[READING_PARAS]", readingParas],
    ["[PLAYBOOK_ITEMS]", playbookItems],
    ["[CASE_ITEMS]", caseItems],
    ["[PLAY_ITEMS]", playItems],
    ["[PLATFORM_ITEMS]", platformItems],
    ["[PLAN_ITEMS]", planItems],
  ];
  for (const [token, value] of replacements) {
    html = html.split(token).join(value);
  }

  if (accent) {
    const style = `<style>:root{--brand-accent: ${accent};}</style>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${style}</body>`) : html + style;
  }

  return html;
}
