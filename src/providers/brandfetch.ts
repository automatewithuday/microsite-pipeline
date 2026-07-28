// Thin Brandfetch Brand API client. Confirmed against
// docs.brandfetch.com/reference/brand-api (2026-07-23, docs-derived, not
// live-tested: when BRANDFETCH_API_KEY is unset, this path is exercised
// only by mocked unit tests). GET /v2/brands/domain/{domain}, Bearer auth,
// response.logos is the array selectBrandfetchLogo (src/pure/logoExtract.ts)
// expects.

import { BRANDFETCH_API_KEY } from "../db.js";

const BASE_URL = "https://api.brandfetch.io";

export interface BrandfetchResult {
  logos: unknown[];
  raw: unknown;
}

/** Returns null on any non-200 response (including a genuine domain miss). */
export async function fetchBrandfetchLogos(domain: string, timeoutMs: number): Promise<BrandfetchResult | null> {
  if (!BRANDFETCH_API_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/v2/brands/domain/${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${BRANDFETCH_API_KEY}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { logos?: unknown };
    const logos = Array.isArray(body.logos) ? body.logos : [];
    return { logos, raw: body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
