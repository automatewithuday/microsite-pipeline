// Step 03: deterministic CRM detection. No LLM. Fetch the homepage with a
// desktop UA, fall back to Firecrawl if the plain fetch fails or returns
// thin HTML, then try one secondary page (/pricing, then /about, first
// plain fetch that succeeds) if still thin. Match the known CRM
// signatures, first hit wins.

import { FIRECRAWL_API_KEY, type LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { isCoolingDown, RateLimitError, remainingCooldownMs, setCooldown } from "../providerCooldown.js";
import { detectCrm } from "../pure/crmSignatures.js";
import { toHttpUrl } from "../pure/normalize.js";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15_000;
const THIN_HTML_THRESHOLD = 2000;
const FIRECRAWL_COST_USD = 0.001;
const FIRECRAWL_COOLDOWN_MS = 30_000;
const SECONDARY_PAGES = ["/pricing", "/about"];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function plainFetch(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": DESKTOP_UA },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// formats: [{ type: "rawHtml" }], not "html": Firecrawl's cleaned "html"
// format strips <script> tags, which is exactly what the CRM signatures
// need to see (js.hs-scripts.com etc).
async function firecrawlFetch(url: string): Promise<string | null> {
  // No key: skip the paid fallback, the caller uses the plain fetch (degradation).
  if (!FIRECRAWL_API_KEY) return null;

  if (isCoolingDown("firecrawl")) {
    await sleep(remainingCooldownMs("firecrawl"));
  }

  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: [{ type: "rawHtml" }] }),
  });

  if (res.status === 429) {
    setCooldown("firecrawl", FIRECRAWL_COOLDOWN_MS);
    throw new RateLimitError("firecrawl");
  }
  if (!res.ok) return null;

  const body = (await res.json()) as { data?: { rawHtml?: string | null } };
  return body.data?.rawHtml ?? null;
}

interface HomepageFetch {
  html: string;
  usedFirecrawl: boolean;
}

async function fetchHomepage(website: string): Promise<HomepageFetch | null> {
  const viaFetch = await plainFetch(website);
  if (viaFetch !== null && viaFetch.length >= THIN_HTML_THRESHOLD) {
    return { html: viaFetch, usedFirecrawl: false };
  }

  const viaFirecrawl = await firecrawlFetch(website);
  if (viaFirecrawl !== null) {
    return { html: viaFirecrawl, usedFirecrawl: true };
  }

  // Neither Firecrawl nor a thin/failed plain fetch gave us nothing at all:
  // prefer whatever the plain fetch got, even thin, over nothing, so a
  // secondary page still has a chance.
  if (viaFetch !== null) {
    return { html: viaFetch, usedFirecrawl: false };
  }

  return null;
}

async function fetchFirstSecondaryPage(website: string): Promise<{ html: string; page: string } | null> {
  for (const path of SECONDARY_PAGES) {
    const url = new URL(path, website).toString();
    const html = await plainFetch(url);
    if (html !== null) return { html, page: path };
  }
  return null;
}

async function run(lead: LeadRow): Promise<StepResult> {
  const companyData = lead.company_data as { merged?: { website?: unknown } } | null | undefined;
  const rawWebsite = typeof companyData?.merged?.website === "string" ? companyData.merged.website : null;
  // Deepline returns website as a bare domain; make it a fetchable URL so
  // the free plain fetch gets a chance before the paid Firecrawl fallback.
  const website = toHttpUrl(rawWebsite);

  if (!website) {
    return { skipped: "company website is null" };
  }

  const homepage = await fetchHomepage(website);
  if (!homepage) {
    return { skipped: `could not fetch homepage HTML for ${website}` };
  }

  const firecrawlPages = homepage.usedFirecrawl ? 1 : 0;

  // Match on the homepage HTML first, thin or not: a thin page can still
  // carry the signature script tag. Only when the homepage has no match do
  // we spend a request on a secondary page, and only its own match (never
  // the homepage's absence of one) determines the stored page attribution.
  let { platform, matched } = detectCrm(homepage.html);
  let page = "homepage";

  if (platform === null && homepage.html.length < THIN_HTML_THRESHOLD) {
    const secondary = await fetchFirstSecondaryPage(website);
    if (secondary) {
      const secondaryResult = detectCrm(secondary.html);
      if (secondaryResult.platform !== null) {
        platform = secondaryResult.platform;
        matched = secondaryResult.matched;
        page = secondary.page;
      }
    }
  }

  const data =
    platform === null
      ? { platform: null, method: "signatures" as const }
      : { platform, method: "signatures" as const, matched, page };

  const cost_usd = firecrawlPages * FIRECRAWL_COST_USD;
  const provider = firecrawlPages > 0 ? "firecrawl" : "none";

  return { data, cost_usd, provider };
}

const step: StepModule = {
  name: "crm",
  column: "crm",
  dependsOn: ["company"],
  run,
};

export default step;
