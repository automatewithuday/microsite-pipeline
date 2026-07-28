// Self-hosted renderer: pure template builder. Interpolation,
// HTML escaping, WCAG contrast math, brand-color selection, and optional
// [Point 1]/[Point 2] block removal against the committed Claude Design
// template. No I/O. 100% unit-covered.
import type { LeadRow } from "../db.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

// Presentation-layer remap for the deck's page-02 ad insight card. adSummary()
// keeps its original contract (returns the exact sentinel below on no ads);
// here we turn that dead stat into a forward-looking GTM line for the microsite.
// Any real ad summary passes through untouched.
const AD_NULL_SENTINEL = "No significant ad activity detected.";
function adInsightCopy(summary: string): string {
  return summary === AD_NULL_SENTINEL
    ? "No paid ad footprint yet, an open channel to build."
    : summary;
}

// The TAM funnel values (tamEstimation, adjustedTam, adjustedTam2) arrive as
// numbers from computeDerived (or occasionally as pre-formatted strings).
// Numbers are rendered with thousands separators (2000000 -> "2,000,000");
// pre-formatted strings pass through untouched; anything else -> "". Unlike
// str(), this does not drop numeric values on the floor (which blanked
// [Y]/[X] in the deck).
function numOrStr(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("en-US");
  }
  if (typeof value === "string") return value;
  return "";
}

// ---------------------------------------------------------------------
// Gate. Same rules as the original deck gate.
// ---------------------------------------------------------------------

export type RenderGateResult = { ok: true } | { ok: false; reason: string };

// The public build renders whenever the core AI outputs are present, so a
// partial-key run (no logo/brand/qualification) still produces an honest,
// lighter deck: the logo slot is dropped and brand colors fall back to cream.
// `strict` (RENDER_STRICT=true) restores the original operator ruleset that
// also requires qualified + logo + a brand color.
export function renderGate(row: LeadRow, strict = false): RenderGateResult {
  const tam = isRecord(row.tam) ? row.tam : null;
  const tamEstimation = typeof tam?.tamEstimation === "number" ? tam.tamEstimation : null;
  if (tamEstimation === null || !(tamEstimation > 0)) {
    return { ok: false, reason: "tam.tamEstimation is missing or not positive" };
  }

  const icpSegments = isRecord(row.icp_segments) ? row.icp_segments : null;
  const segments = Array.isArray(icpSegments?.segments) ? icpSegments.segments : [];
  if (segments.length < 2) {
    return { ok: false, reason: "icp_segments.segments has fewer than 2 entries" };
  }

  const salesSignals = isRecord(row.sales_signals) ? row.sales_signals : null;
  const signals = Array.isArray(salesSignals?.signals) ? salesSignals.signals : [];
  if (signals.length !== 3) {
    return { ok: false, reason: "sales_signals.signals does not have exactly 3 entries" };
  }

  if (strict) {
    if (row.qualified !== true) return { ok: false, reason: "lead is not qualified" };

    const logo = isRecord(row.logo) ? row.logo : null;
    const logoUrl = typeof logo?.url === "string" && logo.url.length > 0 ? logo.url : null;
    if (!logoUrl) return { ok: false, reason: "logo.url is null" };

    const brandColors = isRecord(row.brand_colors) ? row.brand_colors : null;
    const primary = typeof brandColors?.primary === "string" ? brandColors.primary : "";
    const secondary = typeof brandColors?.secondary === "string" ? brandColors.secondary : "";
    if (!brandColors || (!primary && !secondary)) {
      return { ok: false, reason: "brand_colors has no primary or secondary color" };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------
// Data extraction. Reuses the exact extractors proven in the original
// deck renderer. Values are RAW (not yet escaped).
// ---------------------------------------------------------------------

export interface SegmentFields {
  segmentName: string;
  companyCharacteristic: string;
  keyPainPoint: string;
  primaryBuyer: string;
  differentiatingNeed: string;
}

export interface MicrositeData {
  company: string;
  logoUrl: string;
  brandPrimary: string;
  brandSecondary: string;
  point1: string | null;
  point2: string | null;
  point3: string;
  point4: string;
  segment1: SegmentFields;
  segment2: SegmentFields;
  tamEstimation: string;
  adjustedTam: string;
  adjustedTam2: string;
  signals: [string, string, string];
  crmPlatform: string;
}

function readCompanyName(lead: LeadRow): string {
  const companyData = lead.company_data as { merged?: { name?: unknown } } | null | undefined;
  const merged = isRecord(companyData?.merged) ? companyData?.merged : undefined;
  const mergedName = typeof merged?.name === "string" && merged.name.length > 0 ? merged.name : null;
  return mergedName ?? str(lead.company);
}

function readSegment(segments: unknown[], index: number): SegmentFields {
  const s = isRecord(segments[index]) ? (segments[index] as Record<string, unknown>) : {};
  return {
    segmentName: str(s.segmentName),
    companyCharacteristic: str(s.companyCharacteristic),
    keyPainPoint: str(s.keyPainPoint),
    primaryBuyer: str(s.primaryBuyer),
    differentiatingNeed: str(s.differentiatingNeed),
  };
}

export function extractMicrositeData(lead: LeadRow): MicrositeData {
  const logo = isRecord(lead.logo) ? lead.logo : {};
  const brandColors = isRecord(lead.brand_colors) ? lead.brand_colors : {};
  const derived = isRecord(lead.derived) ? lead.derived : {};
  const tam = isRecord(lead.tam) ? lead.tam : {};
  const icpSegments = isRecord(lead.icp_segments) ? lead.icp_segments : {};
  const segments = Array.isArray(icpSegments.segments) ? icpSegments.segments : [];
  const salesSignals = isRecord(lead.sales_signals) ? lead.sales_signals : {};
  const signals = Array.isArray(salesSignals.signals) ? salesSignals.signals : [];

  return {
    company: readCompanyName(lead),
    logoUrl: str(logo.url),
    brandPrimary: str(brandColors.primary),
    brandSecondary: str(brandColors.secondary),
    point1: typeof derived.paidSearchPct === "string" ? derived.paidSearchPct : null,
    point2: typeof derived.liFollowersInsight === "string" ? derived.liFollowersInsight : null,
    point3: adInsightCopy(str(derived.adSummary)),
    point4: str(derived.sdrInsight),
    segment1: readSegment(segments, 0),
    segment2: readSegment(segments, 1),
    tamEstimation: numOrStr(tam.tamEstimation),
    adjustedTam: numOrStr(derived.adjustedTam),
    adjustedTam2: numOrStr(derived.adjustedTam2),
    signals: [str(signals[0]), str(signals[1]), str(signals[2])],
    crmPlatform: str(derived.crmPlatform, "your CRM"),
  };
}

// ---------------------------------------------------------------------
// HTML escaping. Untrusted LLM-generated values.
// ---------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------
// Contrast math. WCAG AA, ratio >= 4.5:1 vs #111111.
// ---------------------------------------------------------------------

// Parse "#rgb" or "#rrggbb" to [r,g,b] 0-255, or null if unparseable.
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m || m[1] === undefined) return null;
  // Expand 3-digit shorthand (#abc -> #aabbcc) via a type-safe replace.
  const h = m[1].length === 3 ? m[1].replace(/(.)/g, "$1$1") : m[1];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

// WCAG relative luminance of an sRGB color.
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Contrast ratio of a color vs the deck's #111111 body text.
const TEXT_LUM = relativeLuminance([0x11, 0x11, 0x11]);
function contrastVsText(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const l = relativeLuminance(rgb);
  const [hi, lo] = l > TEXT_LUM ? [l, TEXT_LUM] : [TEXT_LUM, l];
  return (hi + 0.05) / (lo + 0.05);
}

export function pickReadableBrandBg(primary: string, secondary: string): string | null {
  const pc = contrastVsText(primary);
  if (pc !== null && pc >= 4.5) return primary;
  const sc = contrastVsText(secondary);
  if (sc !== null && sc >= 4.5) return secondary;
  return null;
}

// Accent selection for pages with a LIGHT background: the inverse of
// pickReadableBrandBg. Returns the first brand color dark enough to be read
// ON white (contrast >= 4.5 vs #FFFFFF), or null (caller keeps the ink default).
const WHITE_LUM = 1.0;
function contrastVsWhite(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const l = relativeLuminance(rgb);
  return (WHITE_LUM + 0.05) / (l + 0.05);
}

export function pickReadableAccent(primary: string, secondary: string): string | null {
  const pc = contrastVsWhite(primary);
  if (pc !== null && pc >= 4.5) return primary;
  const sc = contrastVsWhite(secondary);
  if (sc !== null && sc >= 4.5) return secondary;
  return null;
}

// ---------------------------------------------------------------------
// Themed logo pick. Brandfetch theme "dark" = dark-colored logo, meant for
// LIGHT backgrounds; "light" = light-colored, for DARK backgrounds.
// ---------------------------------------------------------------------

// Below this relative luminance a background counts as dark enough that the
// dark-colored logo starts blending into it (live-observed with ColdIQ's
// wordmark on its #0B7BFA brand blue, L~0.21; the cream default is ~0.87).
const DARK_BG_LUMINANCE = 0.4;

/**
 * Picks the logo URL variant that suits the page background. `bgHex` is the
 * brand color the cover will actually use, or null when the cream default
 * stays. Falls back across variants, then the base url, then "".
 */
export function pickThemedLogoUrl(logo: Record<string, unknown>, bgHex: string | null): string {
  const base = typeof logo.url === "string" ? logo.url : "";
  const darkTheme = typeof logo.url_dark_theme === "string" ? logo.url_dark_theme : null;
  const lightTheme = typeof logo.url_light_theme === "string" ? logo.url_light_theme : null;
  if (!darkTheme && !lightTheme) return base;

  const rgb = bgHex === null ? null : parseHex(bgHex);
  const bgIsDark = rgb !== null && relativeLuminance(rgb) < DARK_BG_LUMINANCE;
  const preferred = bgIsDark ? lightTheme : darkTheme;
  return preferred ?? darkTheme ?? lightTheme ?? base;
}

// ---------------------------------------------------------------------
// Optional-block removal. Depth-balanced tag scan.
// ---------------------------------------------------------------------

// Remove the entire element carrying data-slot="<slot>": its open tag, all
// contents (including nested same-name tags), and its matching close tag.
// Returns html unchanged if the slot is absent or the markup is malformed.
export function removeSlot(html: string, slot: string): string {
  const attrIdx = html.indexOf(`data-slot="${slot}"`);
  if (attrIdx === -1) return html;

  // Walk back to the '<' that opens this element's tag.
  const openStart = html.lastIndexOf("<", attrIdx);
  if (openStart === -1) return html;
  const nameMatch = /^<\s*([a-zA-Z][\w-]*)/.exec(html.slice(openStart));
  if (!nameMatch || nameMatch[1] === undefined) return html;
  const tag = nameMatch[1];

  const openEnd = html.indexOf(">", attrIdx);
  if (openEnd === -1) return html;

  // Scan forward, counting nested <tag ...> / </tag> to find the match.
  const openRe = new RegExp(`<${tag}(\\s|>|/)`, "g");
  const closeRe = new RegExp(`</${tag}\\s*>`, "g");
  let depth = 1;
  let cursor = openEnd + 1;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return html; // malformed; leave as-is
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + 1;
    } else {
      depth -= 1;
      cursor = nextClose.index + nextClose[0].length;
    }
  }
  return html.slice(0, openStart) + html.slice(cursor);
}

// ---------------------------------------------------------------------
// Full builder. Interp + escaping + block removal +
// brand injection. Returns a single self-contained HTML string.
// ---------------------------------------------------------------------

const CREAM_DEFAULT = "#F5EFE6";

export function buildMicrositeHtml(lead: LeadRow, templateHtml: string): string {
  const d = extractMicrositeData(lead);
  let html = templateHtml;

  // The brand bg is computed up front: the logo variant depends on the
  // background it will sit on (the style injection itself happens last).
  const bg = pickReadableBrandBg(d.brandPrimary, d.brandSecondary);
  const effectiveBg = bg && bg.toUpperCase() !== CREAM_DEFAULT ? bg : null;
  const logoUrl = pickThemedLogoUrl(isRecord(lead.logo) ? lead.logo : {}, effectiveBg);

  // 1. Optional-block removal FIRST (before token replacement), so a removed
  //    block never leaves a dangling escaped value. An absent logo drops the
  //    logo slot entirely rather than rendering an empty <img src> (public
  //    build: logo is an optional step, never fabricated).
  if (d.point1 === null) html = removeSlot(html, "point1");
  if (d.point2 === null) html = removeSlot(html, "point2");
  if (logoUrl === "") html = removeSlot(html, "logo");

  // 2. Token replacements. Longest-prefix tokens first so e.g.
  //    "[Company Characteristic 1]" is replaced before "[Company]".
  const e = escapeHtml;
  const replacements: Array<[string, string]> = [
    ["[LOGO_URL]", e(logoUrl)],
    ["[Company Characteristic 1]", e(d.segment1.companyCharacteristic)],
    ["[Company Characteristic 2]", e(d.segment2.companyCharacteristic)],
    ["[Company]", e(d.company)],
    ["[Point 1]", e(d.point1 ?? "")],
    ["[Point 2]", e(d.point2 ?? "")],
    ["[Point 3]", e(d.point3)],
    ["[Point 4]", e(d.point4)],
    ["[Segment 1]", e(d.segment1.segmentName)],
    ["[Segment 2]", e(d.segment2.segmentName)],
    ["[Key Pain Point 1]", e(d.segment1.keyPainPoint)],
    ["[Key Pain Point 2]", e(d.segment2.keyPainPoint)],
    ["[Primary Buyer 1]", e(d.segment1.primaryBuyer)],
    ["[Primary Buyer 2]", e(d.segment2.primaryBuyer)],
    ["[Differentiating Need 1]", e(d.segment1.differentiatingNeed)],
    ["[Differentiating Need 2]", e(d.segment2.differentiatingNeed)],
    ["[Z]", e(d.tamEstimation)],
    ["[Y]", e(d.adjustedTam)],
    ["[X]", e(d.adjustedTam2)],
    ["[Signal 1]", e(d.signals[0])],
    ["[Signal 2]", e(d.signals[1])],
    ["[Signal 3]", e(d.signals[2])],
    ["[CRM]", e(d.crmPlatform)],
  ];
  for (const [token, value] of replacements) {
    html = html.split(token).join(value);
  }

  // 3. Brand-color injection on pages 1/3/5 only, if a color passes contrast.
  //    Pages here use <section data-label="Cover|ICP|Signals">, which already
  //    reference var(--brand-primary)/var(--brand-secondary); overriding the
  //    :root vars recolors exactly those three pages (2/4/6/7/8 never use them
  //    as a full-page background, so the default cream stays).
  //    The template's own <style> (cream defaults for the brand vars) lives in
  //    the BODY, and at equal :root specificity the later rule wins -- so the
  //    override must be appended at the end of the document, never the head.
  if (effectiveBg) {
    const style = `<style>:root{--brand-primary: ${effectiveBg};--brand-secondary: ${effectiveBg};}</style>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${style}</body>`) : html + style;
  }

  return html;
}
