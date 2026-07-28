// Step 08: brand_colors. Deterministic (replaces the former Claygent Argon
// LLM step). Firecrawl the homepage for rendered HTML, plus a
// best-effort fetch of its linked stylesheets, then hand both to the pure
// src/pure/brandColors.ts algorithm. No LLM calls.

import { type LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { extractBrandColors } from "../pure/brandColors.js";
import { toHttpUrl } from "../pure/normalize.js";
import { firecrawlScrapeRawHtml, FIRECRAWL_PAGE_COST_USD } from "../providers/firecrawl.js";

const FETCH_TIMEOUT_MS = 15_000;
const THIN_HTML_THRESHOLD = 2000;
const MAX_STYLESHEETS = 3;

async function plainFetch(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractStylesheetHrefs(html: string, baseUrl: string): string[] {
  const hrefs: string[] = [];
  const linkRe = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null) {
    const tag = match[0];
    if (!/rel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
    const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch?.[1]) continue;
    try {
      hrefs.push(new URL(hrefMatch[1], baseUrl).toString());
    } catch {
      // Malformed href; skip rather than throw.
    }
  }
  return hrefs.slice(0, MAX_STYLESHEETS);
}

async function run(lead: LeadRow): Promise<StepResult> {
  const companyData = lead.company_data as { merged?: { website?: unknown } } | null | undefined;
  const rawWebsite = typeof companyData?.merged?.website === "string" ? companyData.merged.website : null;
  const website = toHttpUrl(rawWebsite);

  if (!website) {
    return { skipped: "company website is null" };
  }

  let html = await plainFetch(website);
  let usedFirecrawl = false;

  if (html === null || html.length < THIN_HTML_THRESHOLD) {
    const viaFirecrawl = await firecrawlScrapeRawHtml(website);
    if (viaFirecrawl !== null) {
      html = viaFirecrawl;
      usedFirecrawl = true;
    }
  }

  if (html === null) {
    return { skipped: `could not fetch homepage HTML for ${website}` };
  }

  const stylesheetUrls = extractStylesheetHrefs(html, website);
  const stylesheets: string[] = [];
  for (const url of stylesheetUrls) {
    const css = await plainFetch(url);
    if (css !== null) stylesheets.push(css);
  }

  const { primary, secondary, notes } = extractBrandColors({ html, stylesheets });

  const data = {
    primary,
    secondary,
    notes,
    raw_source: { website, stylesheet_urls: stylesheetUrls, used_firecrawl: usedFirecrawl },
    // Full scraped content that drove the color pick, so it is auditable
    // without re-scraping (store full raw responses, never discard the
    // payload extraction read from).
    raw: { html, stylesheets },
  };

  const cost_usd = usedFirecrawl ? FIRECRAWL_PAGE_COST_USD : 0;
  const provider = usedFirecrawl ? "firecrawl" : "none";

  return { data, cost_usd, provider };
}

const step: StepModule = {
  name: "brand_colors",
  column: "brand_colors",
  dependsOn: ["company"],
  run,
};

export default step;
