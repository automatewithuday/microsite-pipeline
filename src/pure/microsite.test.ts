import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  renderGate,
  extractMicrositeData,
  escapeHtml,
  pickReadableBrandBg,
  removeSlot,
  buildMicrositeHtml,
  pickThemedLogoUrl,
} from "./microsite.js";
import type { LeadRow } from "../db.js";

function baseLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "test-id",
    company: "Acme",
    qualified: true,
    step_status: {},
    tam: { tamEstimation: 2000000 },
    icp_segments: {
      segments: [
        { segmentName: "S1", companyCharacteristic: "C1", keyPainPoint: "P1", primaryBuyer: "B1", differentiatingNeed: "N1" },
        { segmentName: "S2", companyCharacteristic: "C2", keyPainPoint: "P2", primaryBuyer: "B2", differentiatingNeed: "N2" },
      ],
    },
    sales_signals: { signals: ["sig1", "sig2", "sig3"] },
    logo: { url: "https://logo.example/l.png" },
    brand_colors: { primary: "#F5EFE6", secondary: "#FF4D00" },
    company_data: { merged: { name: "Acme Inc" } },
    derived: {
      paidSearchPct: "40% paid search",
      liFollowersInsight: "1,200 LinkedIn followers",
      adSummary: "running 3 ad campaigns",
      sdrInsight: "no SDRs found",
      crmPlatform: "HubSpot",
      adjustedTam: "1,800,000",
      adjustedTam2: "1,200,000",
    },
    ...overrides,
  } as LeadRow;
}

describe("renderGate (default / public)", () => {
  it("passes a fully-populated lead", () => {
    expect(renderGate(baseLead())).toEqual({ ok: true });
  });
  // The core AI outputs are always required, in both modes.
  it("fails when tam is missing entirely", () => {
    const lead = baseLead();
    delete (lead as Record<string, unknown>).tam;
    expect(renderGate(lead).ok).toBe(false);
  });
  it("fails when tamEstimation is not positive", () => {
    expect(renderGate(baseLead({ tam: { tamEstimation: 0 } })).ok).toBe(false);
  });
  it("fails with fewer than 2 segments", () => {
    expect(renderGate(baseLead({ icp_segments: { segments: [{ segmentName: "S1" }] } })).ok).toBe(false);
  });
  it("fails when icp_segments is missing", () => {
    const lead = baseLead();
    delete (lead as Record<string, unknown>).icp_segments;
    expect(renderGate(lead).ok).toBe(false);
  });
  it("fails when signals is not exactly 3", () => {
    expect(renderGate(baseLead({ sales_signals: { signals: ["a", "b"] } })).ok).toBe(false);
  });
  it("fails when sales_signals is missing", () => {
    const lead = baseLead();
    delete (lead as Record<string, unknown>).sales_signals;
    expect(renderGate(lead).ok).toBe(false);
  });
  // The optional-step fields do NOT block the default (public) gate.
  it("passes when not qualified (degradation)", () => {
    expect(renderGate(baseLead({ qualified: false })).ok).toBe(true);
  });
  it("passes when logo is missing (degradation)", () => {
    const lead = baseLead();
    delete (lead as Record<string, unknown>).logo;
    expect(renderGate(lead).ok).toBe(true);
  });
  it("passes when brand_colors is missing (degradation)", () => {
    const lead = baseLead();
    delete (lead as Record<string, unknown>).brand_colors;
    expect(renderGate(lead).ok).toBe(true);
  });
});

describe("renderGate (strict / RENDER_STRICT)", () => {
  it("passes a fully-populated qualified lead", () => {
    expect(renderGate(baseLead(), true)).toEqual({ ok: true });
  });
  it("fails when not qualified", () => {
    expect(renderGate(baseLead({ qualified: false }), true).ok).toBe(false);
  });
  it("fails when logo.url is empty", () => {
    expect(renderGate(baseLead({ logo: { url: "" } }), true).ok).toBe(false);
  });
  it("fails when logo is missing", () => {
    const lead = baseLead();
    delete (lead as Record<string, unknown>).logo;
    expect(renderGate(lead, true).ok).toBe(false);
  });
  it("fails when brand_colors has neither color", () => {
    expect(renderGate(baseLead({ brand_colors: { primary: "", secondary: "" } }), true).ok).toBe(false);
  });
  it("fails when brand_colors is missing", () => {
    const lead = baseLead();
    delete (lead as Record<string, unknown>).brand_colors;
    expect(renderGate(lead, true).ok).toBe(false);
  });
  it("passes when only secondary brand color is present", () => {
    expect(renderGate(baseLead({ brand_colors: { secondary: "#FF4D00" } }), true).ok).toBe(true);
  });
});

describe("extractMicrositeData", () => {
  it("prefers company_data.merged.name over lead.company", () => {
    expect(extractMicrositeData(baseLead()).company).toBe("Acme Inc");
  });
  it("falls back to lead.company when merged name absent", () => {
    const lead = baseLead({ company_data: {} });
    expect(extractMicrositeData(lead).company).toBe("Acme");
  });
  it("nulls point1/point2 when derived insights are non-strings", () => {
    const lead = baseLead({ derived: { adSummary: "x", sdrInsight: "y" } });
    const d = extractMicrositeData(lead);
    expect(d.point1).toBeNull();
    expect(d.point2).toBeNull();
  });
  it("remaps the no-ads sentinel to forward-looking copy for point3", () => {
    const lead = baseLead({ derived: { adSummary: "No significant ad activity detected." } });
    expect(extractMicrositeData(lead).point3).toBe(
      "No paid ad footprint yet, an open channel to build.",
    );
  });
  it("passes a real ad summary through to point3 untouched", () => {
    const lead = baseLead({ derived: { adSummary: "running 3 ad campaigns" } });
    expect(extractMicrositeData(lead).point3).toBe("running 3 ad campaigns");
  });
  it("defaults crmPlatform to 'your CRM'", () => {
    const lead = baseLead({ derived: {} });
    expect(extractMicrositeData(lead).crmPlatform).toBe("your CRM");
  });
  it("stringifies tamEstimation", () => {
    expect(extractMicrositeData(baseLead()).tamEstimation).toBe("2,000,000");
  });
  it("stringifies NUMERIC adjustedTam / adjustedTam2 (funnel [Y]/[X] regression)", () => {
    const lead = baseLead({ derived: { adjustedTam: 1800000, adjustedTam2: 1200000 } });
    const d = extractMicrositeData(lead);
    expect(d.adjustedTam).toBe("1,800,000");
    expect(d.adjustedTam2).toBe("1,200,000");
  });
  it("keeps pre-formatted string TAM values as-is", () => {
    const lead = baseLead({ derived: { adjustedTam: "1,800,000", adjustedTam2: "1,200,000" } });
    const d = extractMicrositeData(lead);
    expect(d.adjustedTam).toBe("1,800,000");
    expect(d.adjustedTam2).toBe("1,200,000");
  });
  it("blanks non-number non-string TAM values", () => {
    const lead = baseLead({ derived: { adjustedTam: null, adjustedTam2: undefined } });
    const d = extractMicrositeData(lead);
    expect(d.adjustedTam).toBe("");
    expect(d.adjustedTam2).toBe("");
  });
  it("reads all segment fields", () => {
    const d = extractMicrositeData(baseLead());
    expect(d.segment1.keyPainPoint).toBe("P1");
    expect(d.segment2.primaryBuyer).toBe("B2");
  });
  it("tolerates a completely empty lead", () => {
    const d = extractMicrositeData({ id: "x", step_status: {} } as LeadRow);
    expect(d.company).toBe("");
    expect(d.signals).toEqual(["", "", ""]);
    expect(d.crmPlatform).toBe("your CRM");
  });
});

describe("escapeHtml", () => {
  it("escapes all five entities", () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;"
    );
  });
  it("escapes & first so entities are not double-escaped", () => {
    expect(escapeHtml("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});

describe("pickReadableBrandBg", () => {
  it("prefers primary when it passes 4.5:1 vs #111", () => {
    expect(pickReadableBrandBg("#F5EFE6", "#FF4D00")).toBe("#F5EFE6");
  });
  it("falls back to secondary when primary fails", () => {
    expect(pickReadableBrandBg("#111111", "#F5EFE6")).toBe("#F5EFE6");
  });
  it("returns null when both fail", () => {
    expect(pickReadableBrandBg("#000000", "#222222")).toBeNull();
  });
  it("returns null for unparseable colors", () => {
    expect(pickReadableBrandBg("not-a-color", "")).toBeNull();
  });
  it("accepts 3-digit hex", () => {
    expect(pickReadableBrandBg("#fff", "#000")).toBe("#fff");
  });
  it("falls back to secondary when primary is unparseable", () => {
    expect(pickReadableBrandBg("rgb(0,0,0)", "#ffffff")).toBe("#ffffff");
  });
});

describe("removeSlot", () => {
  it("removes the whole tagged element including nested children", () => {
    const html = `<div data-slot="x"><span>a</span><span>b</span></div><p>keep</p>`;
    expect(removeSlot(html, "x")).toBe(`<p>keep</p>`);
  });
  it("removes an element with nested same-name tags (depth balanced)", () => {
    const html = `<div data-slot="x"><div>inner</div>tail</div><p>keep</p>`;
    expect(removeSlot(html, "x")).toBe(`<p>keep</p>`);
  });
  it("leaves html unchanged when the slot is absent", () => {
    expect(removeSlot(`<p>keep</p>`, "x")).toBe(`<p>keep</p>`);
  });
  it("leaves html unchanged when the close tag is missing (malformed)", () => {
    const html = `<div data-slot="x"><span>a</span>`;
    expect(removeSlot(html, "x")).toBe(html);
  });
});

describe("buildMicrositeHtml", () => {
  const FAKE_TEMPLATE = `<!doctype html><html><head><style>
:root{--brand-primary:var(--cream);--brand-secondary:var(--cream);}
</style></head><body>
<section data-label="Cover" style="background:var(--brand-primary)"><div data-slot="logo"><img src="[LOGO_URL]"></div><h1>[Company]</h1></section>
<section data-label="Insights">
<div class="card" data-slot="point1">1. [Point 1]</div>
<div class="card" data-slot="point2">2. [Point 2]</div>
<div class="card">3. [Point 3]</div>
<div class="card">4. [Point 4]</div>
</section>
<section data-label="ICP">[Segment 1] [Company Characteristic 1] [Key Pain Point 1] [Primary Buyer 1] [Differentiating Need 1] [Segment 2] [Company Characteristic 2] [Key Pain Point 2] [Primary Buyer 2] [Differentiating Need 2]</section>
<section data-label="TAM">[Z] [Y] [X]</section>
<section data-label="Signals">[Signal 1] [Signal 2] [Signal 3]</section>
<section data-label="Integration">PLUGS INTO [CRM]</section>
<section data-label="Proof">STATIC PROOF 2,700+ $250K</section>
<section data-label="CTA">[Company]</section>
</body></html>`;

  function lead(overrides: Record<string, unknown> = {}) {
    return {
      id: "id", company: "Acme", qualified: true, step_status: {},
      tam: { tamEstimation: 2000000 },
      icp_segments: { segments: [
        { segmentName: "S1", companyCharacteristic: "C1", keyPainPoint: "P1", primaryBuyer: "B1", differentiatingNeed: "N1" },
        { segmentName: "S2", companyCharacteristic: "C2", keyPainPoint: "P2", primaryBuyer: "B2", differentiatingNeed: "N2" },
      ] },
      sales_signals: { signals: ["sig1", "sig2", "sig3"] },
      logo: { url: "https://logo.example/l.png?a=1&b=2" },
      brand_colors: { primary: "#F5EFE6", secondary: "#FF4D00" },
      company_data: { merged: { name: "Acme Inc" } },
      derived: { paidSearchPct: "40%", liFollowersInsight: "1,200 followers",
        adSummary: "3 campaigns", sdrInsight: "no SDRs", crmPlatform: "HubSpot",
        adjustedTam: "1,800,000", adjustedTam2: "1,200,000" },
      ...overrides,
    } as unknown as LeadRow;
  }

  it("replaces every token when all values present, no [bracket] survives", () => {
    const out = buildMicrositeHtml(lead(), FAKE_TEMPLATE);
    expect(out).not.toMatch(/\[[A-Za-z0-9 ]+\]/);
    expect(out).toContain("Acme Inc");
    expect(out).toContain("sig1");
    expect(out).toContain("HubSpot");
  });

  it("escapes untrusted signal/segment text", () => {
    const out = buildMicrositeHtml(
      lead({ sales_signals: { signals: ["<script>x</script>", "s2", "s3"] } }),
      FAKE_TEMPLATE
    );
    expect(out).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(out).not.toContain("<script>x</script>");
  });

  it("escapes the logo url in attribute context", () => {
    const out = buildMicrositeHtml(lead(), FAKE_TEMPLATE);
    expect(out).toContain('src="https://logo.example/l.png?a=1&amp;b=2"');
  });

  it("removes the logo slot when there is no logo url (never an empty <img>)", () => {
    const out = buildMicrositeHtml(lead({ logo: { url: "" } }), FAKE_TEMPLATE);
    expect(out).not.toContain('data-slot="logo"');
    expect(out).not.toContain("[LOGO_URL]");
    expect(out).not.toContain("<img");
    // The rest of the deck still renders.
    expect(out).toContain("Acme Inc");
  });

  it("removes the point1 block when paidSearchPct is null", () => {
    const d = lead().derived as Record<string, unknown>;
    const out = buildMicrositeHtml(lead({ derived: { ...d, paidSearchPct: null } }), FAKE_TEMPLATE);
    expect(out).not.toContain('data-slot="point1"');
    expect(out).not.toContain("1. ");
    // point2 still present
    expect(out).toContain("1,200 followers");
  });

  it("keeps the point2 block when present", () => {
    const out = buildMicrositeHtml(lead(), FAKE_TEMPLATE);
    expect(out).toContain('data-slot="point2"');
    expect(out).toContain("1,200 followers");
  });

  it("falls back to 'your CRM' when crmPlatform missing", () => {
    const d = lead().derived as Record<string, unknown>;
    const out = buildMicrositeHtml(lead({ derived: { ...d, crmPlatform: undefined } }), FAKE_TEMPLATE);
    expect(out).toContain("PLUGS INTO your CRM");
  });

  it("injects brand primary on :root when it passes contrast", () => {
    const out = buildMicrositeHtml(lead(), FAKE_TEMPLATE);
    // #F5EFE6 IS the cream default, so no override is injected (would be a no-op).
    expect(out).not.toContain("--brand-primary: #F5EFE6");
  });

  it("injects a non-cream readable primary override", () => {
    const out = buildMicrositeHtml(lead({ brand_colors: { primary: "#FFFFFF", secondary: "#000000" } }), FAKE_TEMPLATE);
    expect(out).toContain("--brand-primary: #FFFFFF");
    expect(out).toContain("--brand-secondary: #FFFFFF");
  });

  it("injects nothing when both brand colors fail contrast", () => {
    const out = buildMicrositeHtml(lead({ brand_colors: { primary: "#000000", secondary: "#111111" } }), FAKE_TEMPLATE);
    expect(out).not.toContain("--brand-primary: #000000");
    expect(out).not.toContain("--brand-primary: #111111");
  });

  it("never alters page 7 proof text", () => {
    const out = buildMicrositeHtml(lead(), FAKE_TEMPLATE);
    expect(out).toContain("STATIC PROOF 2,700+ $250K");
  });
});

describe("buildMicrositeHtml against the real committed template", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const templatePath = resolve(here, "../../templates/microsite/index.html");
  const realTemplate = readFileSync(templatePath, "utf8");

  function realLead() {
    return {
      id: "8442b5a1", company: "MarTechs", qualified: true, step_status: {},
      tam: { tamEstimation: 2000000 },
      icp_segments: { segments: [
        { segmentName: "Seed SaaS", companyCharacteristic: "10-50 heads", keyPainPoint: "no pipeline", primaryBuyer: "Founder", differentiatingNeed: "GTM ops" },
        { segmentName: "Series A", companyCharacteristic: "50-200 heads", keyPainPoint: "leaky funnel", primaryBuyer: "VP Sales", differentiatingNeed: "clean data" },
      ] },
      sales_signals: { signals: ["<b>bold</b> signal one", "signal two", "signal three"] },
      logo: { url: "https://logo.example/m.png" },
      brand_colors: { primary: "#FFFFFF", secondary: "#123456" },
      company_data: { merged: { name: "MarTechs Inc" } },
      derived: { paidSearchPct: "40% paid", liFollowersInsight: "900 followers",
        adSummary: "2 campaigns", sdrInsight: "1 SDR", crmPlatform: "HubSpot",
        adjustedTam: "1,800,000", adjustedTam2: "1,200,000" },
    } as unknown as LeadRow;
  }

  it("leaves no [bracket] tokens in the real rendered output", () => {
    const out = buildMicrositeHtml(realLead(), realTemplate);
    const leftover = out.match(/\[[A-Za-z0-9 ]+\]/g);
    expect(leftover).toBeNull();
  });

  it("renders all three TAM funnel numbers (numeric adjustedTam/adjustedTam2)", () => {
    const l = realLead();
    (l.derived as Record<string, unknown>).adjustedTam = 1800000; // numeric, as computeDerived emits
    (l.derived as Record<string, unknown>).adjustedTam2 = 1200000;
    const out = buildMicrositeHtml(l, realTemplate);
    // Grab the TAM section and confirm all three tiers carry a number.
    const start = out.indexOf('data-label="TAM"');
    const tam = out.slice(start, out.indexOf("</section>", start));
    expect(tam).toContain("2,000,000"); // [Z]
    expect(tam).toContain("1,800,000"); // [Y]
    expect(tam).toContain("1,200,000"); // [X]
  });

  it("escapes untrusted signal HTML in the real template", () => {
    const out = buildMicrositeHtml(realLead(), realTemplate);
    expect(out).toContain("&lt;b&gt;bold&lt;/b&gt; signal one");
    expect(out).not.toContain("<b>bold</b> signal one");
  });

  it("keeps the page-7 proof block byte-identical to the template", () => {
    const out = buildMicrositeHtml(realLead(), realTemplate);
    const proofOf = (h: string) => {
      const start = h.indexOf('data-label="Proof"');
      const end = h.indexOf("</section>", start) + "</section>".length;
      return h.slice(start, end);
    };
    expect(proofOf(out)).toBe(proofOf(realTemplate));
  });

  it("injects a non-cream readable brand override into :root", () => {
    const out = buildMicrositeHtml(realLead(), realTemplate);
    expect(out).toContain("--brand-primary: #FFFFFF");
  });

  it("removes point1 block from the real template when paidSearchPct is null", () => {
    const l = realLead();
    (l.derived as Record<string, unknown>).paidSearchPct = null;
    const out = buildMicrositeHtml(l, realTemplate);
    expect(out).not.toContain('data-slot="point1"');
    expect(out).toContain('data-slot="point2"');
  });
});

describe("buildMicrositeHtml brand-color injection", () => {
  // The real template keeps its <style> (with the cream defaults for
  // --brand-primary/--brand-secondary) inside the BODY, not the head. At
  // equal :root specificity the later rule wins, so the injected override
  // must land after the template's own definition or the cream default
  // silently wins (live-observed on the coldiq.com deck, 2026-07-28).
  const BODY_STYLE_TEMPLATE = `<!doctype html><html><head></head><body>
<helmet><style>
:root{--cream:#F5EFE6;--brand-primary:var(--cream);--brand-secondary:var(--cream);}
</style></helmet>
<section data-label="Cover" style="background:var(--brand-primary)"><h1>[Company]</h1></section>
</body></html>`;

  function brandLead() {
    return {
      id: "id", company: "ColdIQ", qualified: true, step_status: {},
      tam: { tamEstimation: 1 },
      icp_segments: { segments: [] },
      sales_signals: { signals: [] },
      logo: { url: "" },
      brand_colors: { primary: "#0B7BFA", secondary: "#F9962E" },
      company_data: { merged: { name: "ColdIQ" } },
      derived: {},
    } as unknown as LeadRow;
  }

  it("injects the brand override AFTER the template's own :root definition", () => {
    const out = buildMicrositeHtml(brandLead(), BODY_STYLE_TEMPLATE);
    const overrideAt = out.lastIndexOf("--brand-primary: #0B7BFA");
    const templateDefaultAt = out.indexOf("--brand-primary:var(--cream)");
    expect(overrideAt).toBeGreaterThan(-1);
    expect(templateDefaultAt).toBeGreaterThan(-1);
    expect(overrideAt).toBeGreaterThan(templateDefaultAt);
  });
});

describe("pickThemedLogoUrl", () => {
  // Brandfetch semantics: theme "dark" = dark-colored logo for LIGHT
  // backgrounds; theme "light" = light-colored logo for DARK backgrounds.
  const logo = {
    url: "https://cdn.bf/dark-logo.svg",
    url_dark_theme: "https://cdn.bf/dark-logo.svg",
    url_light_theme: "https://cdn.bf/light-logo.svg",
  };

  it("picks the light-theme (light-colored) logo on a dark brand background", () => {
    expect(pickThemedLogoUrl(logo, "#0B7BFA")).toBe("https://cdn.bf/light-logo.svg");
  });

  it("picks the dark-theme (dark-colored) logo on a light background", () => {
    expect(pickThemedLogoUrl(logo, "#F5EFE6")).toBe("https://cdn.bf/dark-logo.svg");
  });

  it("picks the dark-theme logo when no brand bg was chosen (cream default)", () => {
    expect(pickThemedLogoUrl(logo, null)).toBe("https://cdn.bf/dark-logo.svg");
  });

  it("falls back to the base url when themed variants are absent (scrape path)", () => {
    expect(pickThemedLogoUrl({ url: "https://acme.com/logo.svg" }, "#0B7BFA")).toBe("https://acme.com/logo.svg");
  });

  it("falls back to the other variant when the wanted theme is missing", () => {
    expect(pickThemedLogoUrl({ url: "https://cdn.bf/d.svg", url_dark_theme: "https://cdn.bf/d.svg" }, "#0B7BFA")).toBe("https://cdn.bf/d.svg");
  });

  it("returns empty string when there is no logo at all", () => {
    expect(pickThemedLogoUrl({}, "#0B7BFA")).toBe("");
  });
});

describe("buildMicrositeHtml themed logo integration", () => {
  it("uses the light-theme logo url when the injected brand bg is dark", () => {
    const template = `<!doctype html><html><head></head><body>
<section data-label="Cover"><div data-slot="logo"><img src="[LOGO_URL]"></div><h1>[Company]</h1></section>
</body></html>`;
    const lead = {
      id: "id", company: "ColdIQ", qualified: true, step_status: {},
      tam: { tamEstimation: 1 },
      icp_segments: { segments: [] },
      sales_signals: { signals: [] },
      logo: {
        url: "https://cdn.bf/dark-logo.svg",
        url_dark_theme: "https://cdn.bf/dark-logo.svg",
        url_light_theme: "https://cdn.bf/light-logo.svg",
      },
      brand_colors: { primary: "#0B7BFA", secondary: "#F9962E" },
      company_data: { merged: { name: "ColdIQ" } },
      derived: {},
    } as unknown as LeadRow;

    const out = buildMicrositeHtml(lead, template);
    expect(out).toContain('src="https://cdn.bf/light-logo.svg"');
    expect(out).not.toContain('src="https://cdn.bf/dark-logo.svg"');
  });
});
