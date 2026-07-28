// Deterministic brand-color extraction, replacing the former Claygent Argon
// LLM step. No I/O, no LLM calls.
//
// Algorithm (in priority order):
//   1. CSS custom properties --primary/--secondary and their --brand-*/
//      --color-* aliases win outright when present and non-neutral.
//   2. Else colors from header/nav/hero/primary-button selectors and inline
//      styles on matching elements, ranked by frequency (most-repeated
//      non-neutral color first, then next distinct color).
//   3. Normalize rgb()/rgba()/hsl()/hsla()/#rgb/#rrggbb to #RRGGBB.
//   4. Exclude neutrals: max(R,G,B)-min(R,G,B) < 24, or near-white/near-black.
//   5. {primary, secondary, notes}. Empty strings + note if only neutrals.
//
// This is a regex-based approximation of a real CSS/DOM parser (no cheerio
// or a CSS AST library is in package.json; adding one was out of scope
// here). It is deliberately permissive: selectors are matched by
// substring on class/id/tag name, not full CSS selector semantics. Good
// enough to rank "does this look like a header/nav/hero/button color",
// not a general-purpose CSS engine. Flagged for live-fixture validation.

export interface BrandColorSource {
  html: string;
  /** Linked external stylesheet contents, already fetched by the caller. */
  stylesheets?: string[];
}

export interface BrandColorResult {
  primary: string;
  secondary: string;
  notes: string;
}

const PRIMARY_VAR_NAMES = ["--primary", "--brand-primary", "--color-primary"];
const SECONDARY_VAR_NAMES = ["--secondary", "--brand-secondary", "--color-secondary"];

// Selectors treated as prominent: header/nav/hero/primary-button. Matched by
// substring against a tag+class+id blob, case-insensitively.
const PROMINENT_SELECTOR_HINT = /\b(header|nav|hero|btn-primary|button-primary|primary-button|cta)\b/i;

function isRecordLikeTag(tagAndAttrs: string): boolean {
  return PROMINENT_SELECTOR_HINT.test(tagAndAttrs);
}

// ---- Color normalization -------------------------------------------------

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex2(n: number): string {
  return clamp255(n).toString(16).padStart(2, "0").toUpperCase();
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sFrac = s / 100;
  const lFrac = l / 100;
  const c = (1 - Math.abs(2 * lFrac - 1)) * sFrac;
  const hPrime = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hPrime >= 0 && hPrime < 1) [r1, g1, b1] = [c, x, 0];
  else if (hPrime < 2) [r1, g1, b1] = [x, c, 0];
  else if (hPrime < 3) [r1, g1, b1] = [0, c, x];
  else if (hPrime < 4) [r1, g1, b1] = [0, x, c];
  else if (hPrime < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = lFrac - c / 2;
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

/** Normalizes a CSS color value to "#RRGGBB", or null if unparseable. */
export function normalizeColor(raw: string): string | null {
  const value = raw.trim().replace(/\s*!important$/i, "");

  const hex6 = value.match(/^#([0-9a-f]{6})$/i);
  if (hex6?.[1]) return `#${hex6[1].toUpperCase()}`;

  const hex3 = value.match(/^#([0-9a-f]{3})$/i);
  if (hex3?.[1]) {
    const [r = "", g = "", b = ""] = hex3[1].split("");
    return `#${(r + r + g + g + b + b).toUpperCase()}`;
  }

  const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*[\d.]+\s*)?\)$/i);
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    return `#${toHex2(Number(rgb[1]))}${toHex2(Number(rgb[2]))}${toHex2(Number(rgb[3]))}`;
  }

  const hsl = value.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*[\d.]+\s*)?\)$/i);
  if (hsl?.[1] && hsl[2] && hsl[3]) {
    const [r, g, b] = hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
    return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
  }

  return null;
}

function isNeutral(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 24) return true; // low saturation: gray-ish
  if (r >= 240 && g >= 240 && b >= 240) return true; // near-white
  if (r <= 15 && g <= 15 && b <= 15) return true; // near-black
  return false;
}

// ---- CSS custom property extraction --------------------------------------

function extractCssVars(cssText: string): Map<string, string> {
  const vars = new Map<string, string>();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;}\n]+)\s*[;}]/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cssText)) !== null) {
    const rawName = match[1];
    const rawValue = match[2];
    if (!rawName || rawValue === undefined) continue;
    const name = rawName.toLowerCase();
    if (!vars.has(name)) vars.set(name, rawValue.trim());
  }
  return vars;
}

function resolveVarColor(vars: Map<string, string>, names: string[]): string | null {
  for (const name of names) {
    const raw = vars.get(name);
    if (!raw) continue;
    const hex = normalizeColor(raw);
    if (hex && !isNeutral(hex)) return hex;
  }
  return null;
}

// ---- Selector/inline-style prominence ranking ----------------------------

interface ColorHit {
  hex: string;
  order: number;
}

function collectFromInlineStyles(html: string): ColorHit[] {
  const hits: ColorHit[] = [];
  const tagRe = /<([a-z0-9]+)([^>]*)>/gi;
  let order = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(html)) !== null) {
    const attrs = tagMatch[2] ?? "";
    const tagBlob = `${tagMatch[1] ?? ""} ${attrs}`;
    if (!isRecordLikeTag(tagBlob)) continue;
    const styleMatch = attrs.match(/style\s*=\s*"([^"]*)"/i);
    const styleValue = styleMatch?.[1];
    if (styleValue === undefined) continue;
    const declRe = /(?:background-color|background|color)\s*:\s*([^;]+);?/gi;
    let declMatch: RegExpExecArray | null;
    while ((declMatch = declRe.exec(styleValue)) !== null) {
      const declValue = declMatch[1];
      if (!declValue) continue;
      const hex = normalizeColor(declValue);
      if (hex) hits.push({ hex, order: order++ });
    }
  }
  return hits;
}

function collectFromCssRules(cssText: string): ColorHit[] {
  const hits: ColorHit[] = [];
  const ruleRe = /([^{}]+)\{([^{}]+)\}/g;
  let order = 0;
  let ruleMatch: RegExpExecArray | null;
  while ((ruleMatch = ruleRe.exec(cssText)) !== null) {
    const selector = ruleMatch[1] ?? "";
    const declBlock = ruleMatch[2];
    if (!isRecordLikeTag(selector) || declBlock === undefined) continue;
    const declRe = /(?:background-color|background|color)\s*:\s*([^;]+);/gi;
    let declMatch: RegExpExecArray | null;
    while ((declMatch = declRe.exec(declBlock)) !== null) {
      const declValue = declMatch[1];
      if (!declValue) continue;
      const hex = normalizeColor(declValue);
      if (hex) hits.push({ hex, order: order++ });
    }
  }
  return hits;
}

// Tier-3 fallback scanner. Page builders (Framer, Webflow) emit hashed,
// non-semantic class names (.framer-abc123), so the header/nav/hero/button
// selector filter in collectFromCssRules/collectFromInlineStyles matches
// nothing and the accent color is never collected. This scans every color
// literal in the CSS text regardless of selector; rankColors then excludes
// neutrals and ranks by frequency, so the most-repeated non-neutral color
// (on a brand site, almost always the accent) surfaces. The 6-digit
// alternative is listed before the 3-digit one so #rrggbb is matched whole.
const COLOR_LITERAL_RE = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

function collectAllColors(cssText: string): ColorHit[] {
  const hits: ColorHit[] = [];
  let order = 0;
  let match: RegExpExecArray | null;
  COLOR_LITERAL_RE.lastIndex = 0;
  while ((match = COLOR_LITERAL_RE.exec(cssText)) !== null) {
    const hex = normalizeColor(match[0]);
    if (hex) hits.push({ hex, order: order++ });
  }
  return hits;
}

function rankColors(hits: ColorHit[]): string[] {
  const nonNeutral = hits.filter((h) => !isNeutral(h.hex));
  const freq = new Map<string, { count: number; firstOrder: number }>();
  for (const hit of nonNeutral) {
    const entry = freq.get(hit.hex);
    if (entry) entry.count++;
    else freq.set(hit.hex, { count: 1, firstOrder: hit.order });
  }
  return [...freq.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].firstOrder - b[1].firstOrder)
    .map(([hex]) => hex);
}

// ---- Top-level extraction --------------------------------------------------

function extractStyleBlocks(html: string): string {
  const blocks: string[] = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;
  while ((match = styleRe.exec(html)) !== null) {
    if (match[1] !== undefined) blocks.push(match[1]);
  }
  return blocks.join("\n");
}

export function extractBrandColors(source: BrandColorSource): BrandColorResult {
  const cssText = [extractStyleBlocks(source.html), ...(source.stylesheets ?? [])].join("\n");

  const vars = extractCssVars(cssText);
  const varPrimary = resolveVarColor(vars, PRIMARY_VAR_NAMES);
  const varSecondary = resolveVarColor(vars, SECONDARY_VAR_NAMES);

  if (varPrimary || varSecondary) {
    return {
      primary: varPrimary ?? "",
      secondary: varSecondary ?? "",
      notes: "resolved from css custom properties (--primary/--secondary or alias)",
    };
  }

  const semanticHits = [...collectFromCssRules(cssText), ...collectFromInlineStyles(source.html)];
  let ranked = rankColors(semanticHits);
  let usedBroadScan = false;

  // Tier 3: only when the semantic-selector pass found no non-neutral color
  // (e.g. Framer/Webflow hashed class names), fall back to a broad scan of
  // every color literal in the CSS. Kept subordinate so semantic matches
  // stay authoritative when they exist.
  if (ranked.length === 0) {
    ranked = rankColors(collectAllColors(cssText));
    usedBroadScan = true;
  }

  const bestColor = ranked[0];
  if (bestColor === undefined) {
    return { primary: "", secondary: "", notes: "only neutral colors found; no primary/secondary color detected" };
  }

  if (usedBroadScan) {
    return {
      primary: bestColor,
      secondary: ranked[1] ?? "",
      notes: "no semantic selectors matched; ranked by frequency across all css color literals (page-builder fallback)",
    };
  }

  return {
    primary: bestColor,
    secondary: ranked[1] ?? "",
    notes:
      ranked.length > 1
        ? "ranked by frequency across header/nav/hero/button selectors and inline styles"
        : "only one distinct non-neutral color found; secondary left empty",
  };
}
