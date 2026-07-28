// Step 09: logo. Brandfetch first, Firecrawl-based fallback
// otherwise. When BRANDFETCH_API_KEY is unset in .env, every real run
// takes the fallback path; the Brandfetch branch is exercised only by
// mocked tests until a key is configured.
//
// A null logo is a valid outcome (under the strict render gate it means the
// row will not render); that gating decision belongs to the renderer's gate,
// not this step -- this step only reports honestly, never fabricates a
// logo URL.

import { BRANDFETCH_API_KEY, type LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { extractAnyLogoImg, extractHeaderLogoImg, extractOgImage, selectBrandfetchLogo } from "../pure/logoExtract.js";
import { toHttpUrl } from "../pure/normalize.js";
import { fetchBrandfetchLogos } from "../providers/brandfetch.js";
import { firecrawlScrapeRawHtml, FIRECRAWL_PAGE_COST_USD } from "../providers/firecrawl.js";

const FETCH_TIMEOUT_MS = 15_000;
const THIN_HTML_THRESHOLD = 500;
const SECONDARY_PAGES = ["/press", "/brand"];

function inferFormat(url: string): string | null {
  const match = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  return match?.[1] ? match[1].toLowerCase() : null;
}

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

interface LogoData {
  url: string | null;
  format: string | null;
  variant: string | null;
  source_page: string | null;
}

async function run(lead: LeadRow): Promise<StepResult> {
  const companyData = lead.company_data as
    | { merged?: { domain?: unknown; website?: unknown } }
    | null
    | undefined;
  const domain = typeof companyData?.merged?.domain === "string" ? companyData.merged.domain : null;
  const rawWebsite = typeof companyData?.merged?.website === "string" ? companyData.merged.website : null;
  const website = toHttpUrl(rawWebsite ?? domain);

  if (!domain && !website) {
    return { skipped: "no company domain or website for logo lookup" };
  }

  if (BRANDFETCH_API_KEY && domain) {
    const brandfetchResult = await fetchBrandfetchLogos(domain, FETCH_TIMEOUT_MS);
    const selected = brandfetchResult ? selectBrandfetchLogo(brandfetchResult.logos) : null;
    if (selected && brandfetchResult) {
      const data: LogoData = {
        url: selected.url,
        format: selected.format,
        variant: selected.variant,
        source_page: "brandfetch",
      };
      // Brandfetch pricing was not established during this build (no key
      // configured to test against); recording 0 rather than fabricating a
      // figure, flagged for live validation.
      return { data: { ...data, raw: brandfetchResult.raw }, cost_usd: 0, provider: "brandfetch" };
    }
  }

  if (!website) {
    return { skipped: "no company website for logo fallback" };
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

  const cost_usd = usedFirecrawl ? FIRECRAWL_PAGE_COST_USD : 0;
  const provider = usedFirecrawl ? "firecrawl" : "none";

  let logoUrl: string | null = null;
  let sourcePage: string | null = null;
  // Every candidate logo URL considered along the way, in the order found,
  // so the pick is auditable without re-scraping.
  const candidates: { source: string; url: string }[] = [];
  const secondaryPageHtml: Record<string, string> = {};

  if (html !== null) {
    const ogImage = extractOgImage(html);
    if (ogImage) candidates.push({ source: "og:image", url: ogImage });
    if (!logoUrl && ogImage) {
      logoUrl = ogImage;
      sourcePage = "og:image";
    }

    const headerImg = extractHeaderLogoImg(html);
    if (headerImg) candidates.push({ source: "header_img", url: headerImg });
    if (!logoUrl && headerImg) {
      logoUrl = headerImg;
      sourcePage = "header_img";
    }
  }

  if (!logoUrl) {
    for (const path of SECONDARY_PAGES) {
      const url = new URL(path, website).toString();
      const pageHtml = await plainFetch(url);
      if (pageHtml === null) continue;
      secondaryPageHtml[path] = pageHtml;
      const found = extractAnyLogoImg(pageHtml);
      if (found) {
        candidates.push({ source: path, url: found });
        logoUrl = found;
        sourcePage = path;
        break;
      }
    }
  }

  const data: LogoData & { raw: unknown } = {
    url: logoUrl,
    format: logoUrl ? inferFormat(logoUrl) : null,
    variant: null,
    source_page: sourcePage,
    raw: { html, candidates, secondary_page_html: secondaryPageHtml },
  };

  return { data, cost_usd, provider };
}

const step: StepModule = {
  name: "logo",
  column: "logo",
  dependsOn: ["company"],
  run,
};

export default step;
