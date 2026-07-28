// Pure builders for the follow-up deck: render gate, slug, skim file.
// buildFollowupHtml lives here too (added with the template). No I/O.
// groundedIn citations appear ONLY in the skim, never on the page.

import type { LeadRow } from "../db.js";
import { followupNarrativeSchema, type FollowupNarrative } from "./aiSchemas.js";
import type { ProofLibrary } from "./proofLibrary.js";
import type { RenderGateResult } from "./microsite.js";

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
