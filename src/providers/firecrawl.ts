// Shared Firecrawl scrape client for steps 08 and 09. Same request/response
// shape step 03 already uses inline (POST /v2/scrape, formats:[{type:
// "rawHtml"}], response {data:{rawHtml}}); factored out here so 08/09 don't
// duplicate it. Step 03's own inline copy is deliberately left untouched.

import { FIRECRAWL_API_KEY } from "../db.js";
import { isCoolingDown, RateLimitError, remainingCooldownMs, setCooldown } from "../providerCooldown.js";

export const FIRECRAWL_PAGE_COST_USD = 0.001;
const FIRECRAWL_COOLDOWN_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetches a page's raw (unstripped) HTML via Firecrawl. Null on any failure
 *  or when FIRECRAWL_API_KEY is unset (graceful degradation: the caller falls
 *  back to a plain fetch). */
export async function firecrawlScrapeRawHtml(url: string): Promise<string | null> {
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
