// Inspect-export report builder. Renders every stored step output on a lead
// row as human-readable markdown, mirroring the Clay table columns the
// pipeline was ported from. Pure: no I/O, no LLM calls. Raw provider
// payloads (raw, *_raw, raw_source) stay out of the report by design; they
// remain auditable in the DB. The full research response is exported as its
// own <leadId>.research.md file, so this report only points at it.

import type { LeadRow, StepStatusEntry } from "../db.js";

const NOT_AVAILABLE = "not available";

// Display order for step_status. Unknown step names are appended after.
const STEP_ORDER = [
  "person",
  "company",
  "crm",
  "traffic",
  "ads_meta",
  "ads_google",
  "ads_linkedin",
  "founders",
  "sdr",
  "research",
  "brand_colors",
  "logo",
  "tam",
  "icp_segments",
  "sales_signals",
  "derived",
  "render",
];

// company_data.merged fields shown first, in this order; remaining scalar
// fields follow alphabetically.
const COMPANY_FIELD_ORDER = [
  "name",
  "domain",
  "website",
  "industry",
  "employee_count",
  "description",
  "linkedin_url",
];

const RAW_KEY = /(^|_)raw(_|$)|^raw_source$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-US") : NOT_AVAILABLE;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value.length > 0 ? value : NOT_AVAILABLE;
  return NOT_AVAILABLE;
}

function fmtCost(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "";
}

function field(label: string, value: unknown): string {
  return `- ${label}: ${fmt(value)}`;
}

function column(lead: LeadRow, name: string): Record<string, unknown> {
  const value = lead[name];
  return isRecord(value) ? value : {};
}

function derivedField(lead: LeadRow, name: string): unknown {
  return column(lead, "derived")[name];
}

function stepStatusSection(lead: LeadRow): string[] {
  const status = isRecord(lead.step_status) ? (lead.step_status as Record<string, StepStatusEntry>) : {};
  const names = [
    ...STEP_ORDER.filter((n) => n in status),
    ...Object.keys(status).filter((n) => !STEP_ORDER.includes(n)),
  ];
  if (names.length === 0) return [`_${NOT_AVAILABLE}_`];

  const lines = ["| step | state | provider | cost | error |", "| --- | --- | --- | --- | --- |"];
  for (const name of names) {
    const entry = status[name];
    if (!isRecord(entry)) continue;
    lines.push(
      `| ${name} | ${fmt(entry.state)} | ${typeof entry.provider === "string" ? entry.provider : ""} | ${fmtCost(entry.cost_usd)} | ${typeof entry.error === "string" ? entry.error : ""} |`
    );
  }
  return lines;
}

function companySection(lead: LeadRow): string[] {
  const merged = column(lead, "company_data").merged;
  if (!isRecord(merged)) return [`_${NOT_AVAILABLE}_`];

  const shown = new Set<string>();
  const lines: string[] = [];
  for (const key of COMPANY_FIELD_ORDER) {
    if (key in merged) {
      lines.push(field(key, merged[key]));
      shown.add(key);
    }
  }
  const rest = Object.keys(merged)
    .filter((k) => !shown.has(k) && !RAW_KEY.test(k))
    .filter((k) => ["string", "number", "boolean"].includes(typeof merged[k]))
    .sort();
  for (const key of rest) lines.push(field(key, merged[key]));
  return lines.length > 0 ? lines : [`_${NOT_AVAILABLE}_`];
}

function segmentsSection(lead: LeadRow): string[] {
  const segments = column(lead, "icp_segments").segments;
  if (!Array.isArray(segments) || segments.length === 0) return [`_${NOT_AVAILABLE}_`];

  const lines: string[] = [];
  segments.forEach((segment, i) => {
    const s = isRecord(segment) ? segment : {};
    lines.push(`### Segment ${i + 1}: ${fmt(s.segmentName)}`, "");
    lines.push(field("Company characteristic", s.companyCharacteristic));
    lines.push(field("Key pain point", s.keyPainPoint));
    lines.push(field("Primary buyer", s.primaryBuyer));
    lines.push(field("Differentiating need", s.differentiatingNeed));
    lines.push("");
  });
  return lines;
}

function signalsSection(lead: LeadRow): string[] {
  const signals = column(lead, "sales_signals").signals;
  if (!Array.isArray(signals) || signals.length === 0) return [`_${NOT_AVAILABLE}_`];
  return signals.map((s, i) => `${i + 1}. ${fmt(s)}`);
}

function researchSection(lead: LeadRow): string[] {
  const research = column(lead, "research");
  const response = typeof research.response === "string" ? research.response : null;
  if (response === null) return [`_${NOT_AVAILABLE}_`];
  return [
    field("provider", research.provider),
    `- length: ${response.length.toLocaleString("en-US")} characters`,
    `- full report: see \`${lead.id}.research.md\` next to this file`,
  ];
}

export function buildLeadReport(lead: LeadRow): string {
  const merged = column(lead, "company_data").merged;
  const companyName =
    (isRecord(merged) && typeof merged.name === "string" && merged.name) ||
    (typeof lead.company === "string" && lead.company) ||
    String(lead.id);
  const render = column(lead, "render");

  const sections: [string, string[]][] = [
    [
      "Lead",
      [
        field("id", lead.id),
        field("linkedin_url", lead.linkedin_url),
        field("qualified", lead.qualified),
      ],
    ],
    ["Step status", stepStatusSection(lead)],
    ["Company enrichment", companySection(lead)],
    [
      "Traffic",
      [
        field("total visits", column(lead, "traffic").totalVisits),
        field("paid search visits", column(lead, "traffic").paidSearchVisits),
        field("insight", derivedField(lead, "paidSearchPct")),
      ],
    ],
    [
      "Founder",
      [
        field("first name", column(lead, "founders").first_name),
        field("linkedin followers", column(lead, "founders").num_followers),
        field("insight", derivedField(lead, "liFollowersInsight")),
      ],
    ],
    [
      "Ads",
      [
        field("meta ads count", column(lead, "ads_meta").count),
        field("google ads count", column(lead, "ads_google").count),
        field("linkedin ads count", column(lead, "ads_linkedin").count),
        field("summary", derivedField(lead, "adSummary")),
      ],
    ],
    [
      "SDR",
      [
        field("people count", column(lead, "sdr").peopleCount),
        field("insight", derivedField(lead, "sdrInsight")),
      ],
    ],
    [
      "CRM",
      [
        field("platform", column(lead, "crm").platform),
        field("method", column(lead, "crm").method),
        field("page", column(lead, "crm").page),
      ],
    ],
    [
      "Brand",
      [
        field("primary color", column(lead, "brand_colors").primary),
        field("secondary color", column(lead, "brand_colors").secondary),
        field("logo url", column(lead, "logo").url),
      ],
    ],
    ["Research", researchSection(lead)],
    [
      "TAM",
      [
        field("optimistic (tamEstimation)", column(lead, "tam").tamEstimation),
        field("realistic (tamRealistic)", column(lead, "tam").tamRealistic),
        field("conservative (tamConservative)", column(lead, "tam").tamConservative),
        field("funnel tier 2 (adjustedTam)", derivedField(lead, "adjustedTam")),
        field("funnel tier 3 (adjustedTam2)", derivedField(lead, "adjustedTam2")),
      ],
    ],
    ["ICP segments", segmentsSection(lead)],
    ["Sales signals", signalsSection(lead)],
    [
      "Render",
      [field("page", render.pageUrl), field("pdf", render.pdfUrl)],
    ],
  ];

  const lines: string[] = [`# ${companyName} — lead report`, ""];
  for (const [title, body] of sections) {
    lines.push(`## ${title}`, "", ...body, "");
  }
  return lines.join("\n");
}

/** The full step-07 research report text, or null if research has not run. */
export function extractResearchResponse(lead: LeadRow): string | null {
  const response = column(lead, "research").response;
  return typeof response === "string" && response.length > 0 ? response : null;
}
