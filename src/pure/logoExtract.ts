// Deterministic logo-URL extraction/selection helpers. No I/O, no LLM calls.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extracts <meta property="og:image" content="..."> in either attribute order. */
export function extractOgImage(html: string): string | null {
  const propFirst = html.match(
    /<meta[^>]+property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i
  );
  if (propFirst?.[1]) return propFirst[1];

  const contentFirst = html.match(
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["'][^>]*>/i
  );
  if (contentFirst?.[1]) return contentFirst[1];

  return null;
}

/**
 * Finds an <img> inside a <header> or <nav> block whose src or alt contains
 * "logo" (case-insensitive). Only direct hotlinkable file URLs, never a
 * fabricated/derived one.
 */
export function extractHeaderLogoImg(html: string): string | null {
  const containerRe = /<(header|nav)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let containerMatch: RegExpExecArray | null;
  while ((containerMatch = containerRe.exec(html)) !== null) {
    const inner = containerMatch[2] ?? "";
    const imgRe = /<img\b[^>]*>/gi;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgRe.exec(inner)) !== null) {
      const tag = imgMatch[0];
      const srcMatch = tag.match(/src\s*=\s*["']([^"']+)["']/i);
      const altMatch = tag.match(/alt\s*=\s*["']([^"']*)["']/i);
      const src = srcMatch?.[1] ?? "";
      const alt = altMatch?.[1] ?? "";
      if (/logo/i.test(src) || /logo/i.test(alt)) {
        return src || null;
      }
    }
  }
  return null;
}

/**
 * Finds any <img> on the page (not restricted to header/nav, unlike
 * extractHeaderLogoImg) whose src or alt contains "logo". Used on the
 * /press and /brand fallback pages, where a logo asset is rarely inside a
 * <header>. Only direct hotlinkable file URLs, never fabricated.
 */
export function extractAnyLogoImg(html: string): string | null {
  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html)) !== null) {
    const tag = match[0];
    const srcMatch = tag.match(/src\s*=\s*["']([^"']+)["']/i);
    const altMatch = tag.match(/alt\s*=\s*["']([^"']*)["']/i);
    const src = srcMatch?.[1] ?? "";
    const alt = altMatch?.[1] ?? "";
    if (/logo/i.test(src) || /logo/i.test(alt)) {
      return src || null;
    }
  }
  return null;
}

// Brandfetch Brand API v2 shape (docs.brandfetch.com/reference/brand-api,
// confirmed 2026-07-23): response.logos is an array of logo objects, each
// with `type` ("icon"|"logo"|"symbol"|"other"), `theme` ("dark"|"light" --
// per the docs, theme "dark" means "the dark-colored variant, for display
// on a LIGHT background", i.e. the classic "dark-on-light" logo; "light"
// is the inverse, for dark backgrounds), and a nested `formats` array of
// {src, format, width, height, ...}. This is more specific than the flat
// {type,theme,format,src} shape assumed in an earlier draft of this file;
// selectBrandfetchLogo flattens logos x formats into ranking candidates.
export interface BrandfetchLogoFormat {
  src?: unknown;
  format?: unknown; // "svg" | "png" | "webp" | "jpeg"
  [key: string]: unknown;
}

export interface BrandfetchLogo {
  type?: unknown; // "logo" (wordmark) | "icon" | "symbol" | "other"
  theme?: unknown; // "dark" (dark-on-light) | "light" (light-on-dark)
  formats?: unknown; // BrandfetchLogoFormat[]
  [key: string]: unknown;
}

export interface SelectedLogo {
  url: string;
  format: string;
  variant: string;
  theme: string | null;
}

const TYPE_RANK: Record<string, number> = { logo: 0, symbol: 1, icon: 2, other: 3 };
// Prefer "dark" (dark-on-light, the classic printable wordmark) over
// "light" (light-on-dark, meant for dark page backgrounds).
const THEME_RANK: Record<string, number> = { dark: 0, light: 1 };
const FORMAT_RANK: Record<string, number> = { svg: 0, png: 1, webp: 2, jpg: 3, jpeg: 3 };

function rankOf(table: Record<string, number>, value: unknown, fallback: number): number {
  const key = typeof value === "string" ? value.toLowerCase() : "";
  return table[key] ?? fallback;
}

interface FlatCandidate {
  type: unknown;
  theme: unknown;
  format: unknown;
  src: string;
}

function flattenLogos(logos: unknown[]): FlatCandidate[] {
  const out: FlatCandidate[] = [];
  for (const logo of logos) {
    if (!isRecord(logo)) continue;
    const formats = Array.isArray(logo.formats) ? logo.formats : [];
    for (const fmt of formats) {
      if (!isRecord(fmt)) continue;
      if (typeof fmt.src !== "string" || fmt.src.length === 0) continue;
      out.push({ type: logo.type, theme: logo.theme, format: fmt.format, src: fmt.src });
    }
  }
  return out;
}

function toSelected(best: FlatCandidate | undefined): SelectedLogo | null {
  if (best === undefined) return null;
  return {
    url: best.src,
    format: typeof best.format === "string" ? best.format : "unknown",
    variant: typeof best.type === "string" ? best.type : "unknown",
    theme: typeof best.theme === "string" ? best.theme : null,
  };
}

function rankCandidates(candidates: FlatCandidate[]): FlatCandidate[] {
  return [...candidates].sort((a, b) => {
    const typeDiff = rankOf(TYPE_RANK, a.type, 99) - rankOf(TYPE_RANK, b.type, 99);
    if (typeDiff !== 0) return typeDiff;
    const themeDiff = rankOf(THEME_RANK, a.theme, 99) - rankOf(THEME_RANK, b.theme, 99);
    if (themeDiff !== 0) return themeDiff;
    return rankOf(FORMAT_RANK, a.format, 99) - rankOf(FORMAT_RANK, b.format, 99);
  });
}

/**
 * Selection rules: full wordmark over icon,
 * prefer the dark-on-light variant, prefer svg > png > webp > jpg. Returns
 * null when the logo list is empty or no format has a usable src.
 */
export function selectBrandfetchLogo(logos: unknown[]): SelectedLogo | null {
  return toSelected(rankCandidates(flattenLogos(logos))[0]);
}

/**
 * Best candidate per theme so the renderer can pick the variant that suits
 * the page background it lands on (theme "dark" = dark-colored, for light
 * backgrounds; "light" = light-colored, for dark backgrounds). A theme with
 * no candidates is null.
 */
export function selectBrandfetchLogoByTheme(logos: unknown[]): {
  dark: SelectedLogo | null;
  light: SelectedLogo | null;
} {
  const candidates = flattenLogos(logos);
  const ofTheme = (theme: string) =>
    toSelected(rankCandidates(candidates.filter((c) => typeof c.theme === "string" && c.theme.toLowerCase() === theme))[0]);
  return { dark: ofTheme("dark"), light: ofTheme("light") };
}
