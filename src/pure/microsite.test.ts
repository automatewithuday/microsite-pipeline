import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  renderGate,
  extractMicrositeData,
  escapeHtml,
  pickReadableAccent,
  removeSlot,
  buildMicrositeHtml,
  pickThemedLogoUrl,
  pickDeckCaseStudies,
} from "./microsite.js";
import type { LeadRow } from "../db.js";
import type { ProofLibrary } from "./proofLibrary.js";

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

// Proof-library fixture shared by buildMicrositeHtml's case/plan tests
// (both the fake-template block and the real-committed-template block).
const FULL_LIB: ProofLibrary = {
  profile: { positioning: "p" },
  caseStudies: [
    { id: "dp", client: "DailyPay", verticalTags: ["fintech"], motionTags: ["outbound"],
      problem: "Enterprise outbound at scale", approach: "Built the engine",
      metrics: [{ value: "2,700+", label: "booked demos" }, { value: "9", label: "ignored" }] },
    { id: "re", client: "Reactivation", verticalTags: ["saas"], motionTags: ["abm"],
      problem: "Dead accounts", approach: "CTV + ABM replay",
      metrics: [{ value: "$250K", label: "opportunity revenue" }] },
  ],
  plays: [{ id: "pl", name: "n", whenTags: ["w"], steps: ["s"] }],
  platforms: [],
  plan30day: [
    { title: "Audit", deliverables: ["Full review.", "One document."] },
    { title: "Architect", deliverables: ["SOPs."] },
    { title: "Automate", deliverables: ["Workflows shipped."] },
    { title: "Align", deliverables: ["Sequences live."] },
  ],
} as unknown as ProofLibrary;

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
<section data-label="Work" data-slot="work">
<article data-slot="case1">[Case Client 1] [Case Problem 1] [Case Approach 1] [Case Metric Value 1] [Case Metric Label 1]</article>
<article data-slot="case2">[Case Client 2] [Case Problem 2] [Case Approach 2] [Case Metric Value 2] [Case Metric Label 2]</article>
</section>
<section data-label="Plan" data-slot="plan30">
<div data-slot="plan-phase-1">P1 [Plan Title 1] [Plan Deliverables 1]</div>
<div data-slot="plan-phase-2">P2 [Plan Title 2] [Plan Deliverables 2]</div>
<div data-slot="plan-phase-3">P3 [Plan Title 3] [Plan Deliverables 3]</div>
<div data-slot="plan-phase-4">P4 [Plan Title 4] [Plan Deliverables 4]</div>
</section>
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

  it("injects --brand-accent when a brand color is dark enough to read on white", () => {
    // #0B4F6C contrasts ~8.9:1 vs white (well above the 4.5 AA floor).
    const out = buildMicrositeHtml(
      lead({ brand_colors: { primary: "#0B4F6C", secondary: "" } }),
      FAKE_TEMPLATE
    );
    expect(out).toContain(":root{--brand-accent: #0B4F6C;}");
    expect(out.indexOf("--brand-accent: #0B4F6C")).toBeGreaterThan(out.indexOf("<body>"));
  });

  it("keeps the default accent when both brand colors are too light (pink Signaliz case)", () => {
    const out = buildMicrositeHtml(
      lead({ brand_colors: { primary: "#F8C8DC", secondary: "#FFF0F5" } }),
      FAKE_TEMPLATE
    );
    expect(out).not.toContain("--brand-accent:");
  });

  it("never injects full-page brand background vars (regression: pink Signaliz cover)", () => {
    const out = buildMicrositeHtml(
      lead({ brand_colors: { primary: "#F8C8DC", secondary: "#0B7BFA" } }),
      FAKE_TEMPLATE
    );
    expect(out).not.toContain("--brand-primary: #");
    expect(out).not.toContain("--brand-secondary: #");
  });

  it("always uses the dark-theme logo variant (white pages)", () => {
    const out = buildMicrositeHtml(
      lead({
        logo: { url: "https://l/base.png", url_dark_theme: "https://l/dark.png", url_light_theme: "https://l/light.png" },
        brand_colors: { primary: "#0F1115", secondary: "" }, // dark brand color must NOT flip the logo
      }),
      FAKE_TEMPLATE
    );
    expect(out).toContain("https://l/dark.png");
  });

  it("never rewrites page-7 case metrics: proof-library values render verbatim", () => {
    const out = buildMicrositeHtml(lead(), FAKE_TEMPLATE, FULL_LIB);
    expect(out).toContain("2,700+");
    expect(out).toContain("$250K");
  });

  it("fills case tokens from the library (first metric only, verbatim)", () => {
    const out = buildMicrositeHtml(lead(), FAKE_TEMPLATE, FULL_LIB);
    expect(out).toContain("DailyPay");
    expect(out).toContain("2,700+");
    expect(out).toContain("booked demos");
    expect(out).not.toContain("ignored"); // only metrics[0] renders
    expect(out).not.toMatch(/\[Case [A-Za-z ]+\]/);
  });

  it("fills plan tokens, joining deliverables with a space", () => {
    const out = buildMicrositeHtml(lead(), FAKE_TEMPLATE, FULL_LIB);
    expect(out).toContain("Audit");
    expect(out).toContain("Full review. One document.");
    expect(out).not.toMatch(/\[Plan [A-Za-z ]+\]/);
  });

  it("industry steers the case pick", () => {
    const withIndustry = lead({ company_data: { merged: { name: "Acme Inc", industry: "SaaS" } } });
    const out = buildMicrositeHtml(withIndustry, FAKE_TEMPLATE, FULL_LIB);
    // saas-tagged "Reactivation" becomes case 1
    expect(out.indexOf("Reactivation")).toBeLessThan(out.indexOf("DailyPay"));
  });

  it("removes the whole work section when library is null", () => {
    const out = buildMicrositeHtml(lead(), FAKE_TEMPLATE, null);
    expect(out).not.toContain('data-slot="work"');
    expect(out).not.toContain("[Case Client 1]");
    expect(out).not.toContain('data-slot="plan30"');
    expect(out).not.toContain("[Plan Title 1]");
    // The rest of the deck still renders.
    expect(out).toContain("Acme Inc");
  });

  it("removes only case2 when the library has one case study", () => {
    const oneCase = { ...FULL_LIB, caseStudies: [FULL_LIB.caseStudies[0]] } as ProofLibrary;
    const out = buildMicrositeHtml(lead(), FAKE_TEMPLATE, oneCase);
    expect(out).toContain("DailyPay");
    expect(out).not.toContain('data-slot="case2"');
    expect(out).not.toContain("[Case Client 2]");
  });

  it("removes unused plan phase slots when fewer than 4 phases", () => {
    const twoPhases = { ...FULL_LIB, plan30day: FULL_LIB.plan30day.slice(0, 2) } as ProofLibrary;
    const out = buildMicrositeHtml(lead(), FAKE_TEMPLATE, twoPhases);
    expect(out).toContain("Architect");
    expect(out).not.toContain("P3");
    expect(out).not.toContain("P4");
    expect(out).not.toContain("[Plan Title 3]");
  });

  it("escapes untrusted-looking library text in case tokens", () => {
    const evil = { ...FULL_LIB, caseStudies: [
      { ...FULL_LIB.caseStudies[0], problem: '<img onerror=x>' },
      FULL_LIB.caseStudies[1],
    ] } as ProofLibrary;
    const out = buildMicrositeHtml(lead(), FAKE_TEMPLATE, evil);
    expect(out).toContain("&lt;img onerror=x&gt;");
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

  it("leaves no [bracket] tokens in the real rendered output when the library is populated", () => {
    const out = buildMicrositeHtml(realLead(), realTemplate, FULL_LIB);
    const leftover = out.match(/\[[A-Za-z0-9 ]+\]/g);
    expect(leftover).toBeNull();
  });

  it("leaves no [bracket] tokens in the real rendered output when the library is null (degradation)", () => {
    const out = buildMicrositeHtml(realLead(), realTemplate, null);
    const leftover = out.match(/\[[A-Za-z0-9 ]+\]/g);
    expect(leftover).toBeNull();
  });

  it("renders all three Market funnel numbers (numeric adjustedTam/adjustedTam2)", () => {
    const l = realLead();
    (l.derived as Record<string, unknown>).adjustedTam = 1800000; // numeric, as computeDerived emits
    (l.derived as Record<string, unknown>).adjustedTam2 = 1200000;
    const out = buildMicrositeHtml(l, realTemplate);
    // Grab the Market section and confirm all three tiers carry a number.
    const start = out.indexOf('data-label="Market"');
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

  it("removes the Work and Plan sections from the real template when no library is passed (degradation)", () => {
    const out = buildMicrositeHtml(realLead(), realTemplate);
    expect(out).not.toContain('data-label="Work"');
    expect(out).not.toContain('data-label="Plan"');
  });

  it("fills the Work and Plan sections of the real template verbatim when a library is passed", () => {
    const out = buildMicrositeHtml(realLead(), realTemplate, FULL_LIB);
    const sectionOf = (h: string, label: string) => {
      const start = h.indexOf(`data-label="${label}"`);
      const end = h.indexOf("</section>", start) + "</section>".length;
      return h.slice(start, end);
    };
    expect(sectionOf(out, "Work")).toContain("DailyPay");
    expect(sectionOf(out, "Work")).toContain("2,700+");
    expect(sectionOf(out, "Plan")).toContain("Audit");
    expect(sectionOf(out, "Plan")).toContain("Full review. One document.");
  });

  it("injects a readable brand-accent override into :root", () => {
    // realLead: primary #FFFFFF fails vs white, secondary #123456 passes.
    const out = buildMicrositeHtml(realLead(), realTemplate);
    expect(out).toContain("--brand-accent: #123456");
    expect(out).not.toContain("--brand-primary:");
  });

  it("injects the brand-accent override before the real closing </body>, not into the template's own explanatory comment", () => {
    // Regression guard: the real template's <style> block documents this
    // injection point in a CSS comment that itself contains the literal
    // text "</body>" ("...appended before </body> when AA-safe..."). A
    // naive first-match .replace(/<\/body>/i, ...) lands the override
    // inside that inert comment instead of before the real closing tag,
    // silently disabling the accent feature for every real lead.
    const out = buildMicrositeHtml(realLead(), realTemplate);
    const overrideAt = out.indexOf("--brand-accent: #123456");
    const lastBodyOpenAt = out.lastIndexOf("<body>");
    const lastBodyCloseAt = out.lastIndexOf("</body>");
    expect(overrideAt).toBeGreaterThan(lastBodyOpenAt);
    expect(overrideAt).toBeLessThan(lastBodyCloseAt);
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
  // The template defines its own --brand-accent default at :root (in the
  // head). At equal :root specificity the later rule wins, so the injected
  // override must land after the template's own definition -- appended at
  // the very end of the document, right before </body> -- or the template
  // default silently wins (live-observed on the coldiq.com deck, 2026-07-28).
  const HEAD_STYLE_TEMPLATE = `<!doctype html><html><head><style>
:root{--brand-accent:#FF5A2C;}
</style></head><body>
<section data-label="Cover"><h1 style="color:var(--brand-accent)">[Company]</h1></section>
</body></html>`;

  function brandLead() {
    return {
      id: "id", company: "ColdIQ", qualified: true, step_status: {},
      tam: { tamEstimation: 1 },
      icp_segments: { segments: [] },
      sales_signals: { signals: [] },
      logo: { url: "" },
      // #0B4F6C contrasts ~8.9:1 vs white (well above the 4.5 AA floor).
      brand_colors: { primary: "#0B4F6C", secondary: "#F9962E" },
      company_data: { merged: { name: "ColdIQ" } },
      derived: {},
    } as unknown as LeadRow;
  }

  it("injects the brand-accent override AFTER the template's own :root definition", () => {
    const out = buildMicrositeHtml(brandLead(), HEAD_STYLE_TEMPLATE);
    const overrideAt = out.lastIndexOf("--brand-accent: #0B4F6C");
    const templateDefaultAt = out.indexOf("--brand-accent:#FF5A2C");
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
  it("always uses the dark-theme logo url, even when the brand color is dark (deck pages are always white)", () => {
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
    expect(out).toContain('src="https://cdn.bf/dark-logo.svg"');
    expect(out).not.toContain('src="https://cdn.bf/light-logo.svg"');
  });
});

describe("pickReadableAccent", () => {
  it("returns the primary when it is dark enough against white", () => {
    expect(pickReadableAccent("#0B4F6C", "#cccccc")).toBe("#0B4F6C");
  });
  it("falls back to the secondary when the primary is too light", () => {
    expect(pickReadableAccent("#cccccc", "#0B4F6C")).toBe("#0B4F6C");
  });
  it("returns null when neither is dark enough (or unparseable)", () => {
    expect(pickReadableAccent("#ffffff", "not-a-color")).toBeNull();
  });
});

// Fixture helper for pickDeckCaseStudies tests
function lib(cases: Array<Partial<ProofLibrary["caseStudies"][number]> & { id: string }>): ProofLibrary {
  return {
    profile: { positioning: "p", locationLine: "l", calUrl: "https://example.com", repoLinks: [] },
    caseStudies: cases.map((c) => ({
      client: c.id, verticalTags: ["saas"], motionTags: ["outbound"],
      problem: "prob", approach: "appr", metrics: [{ value: "1x", label: "l" }],
      ...c,
    })),
    plays: [{ id: "pl", name: "n", whenTags: ["w"], steps: ["s"] }],
    platforms: [],
    plan30day: [{ title: "Audit", deliverables: ["d"] }],
  } as ProofLibrary;
}

describe("pickDeckCaseStudies", () => {
  it("returns the first two in curated order when industry is null", () => {
    const out = pickDeckCaseStudies(lib([{ id: "a" }, { id: "b" }, { id: "c" }]), null);
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("puts industry-matched case studies first, curated order preserved", () => {
    const out = pickDeckCaseStudies(
      lib([{ id: "a" }, { id: "b", verticalTags: ["fintech"] }, { id: "c", verticalTags: ["fintech"] }]),
      "Fintech"
    );
    expect(out.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("matches case-insensitively and by substring in either direction", () => {
    const out = pickDeckCaseStudies(
      lib([{ id: "a" }, { id: "b", verticalTags: ["Financial Services"] }]),
      "financial"
    );
    expect(out.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("fills from curated order when only one matches", () => {
    const out = pickDeckCaseStudies(
      lib([{ id: "a" }, { id: "b" }, { id: "c", verticalTags: ["fintech"] }]),
      "fintech"
    );
    expect(out.map((c) => c.id)).toEqual(["c", "a"]);
  });

  it("returns a single case study when the library has only one", () => {
    const out = pickDeckCaseStudies(lib([{ id: "a" }]), "fintech");
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });

  it("ignores empty/whitespace industry", () => {
    const out = pickDeckCaseStudies(lib([{ id: "a" }, { id: "b", verticalTags: ["  "] }]), "  ");
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
