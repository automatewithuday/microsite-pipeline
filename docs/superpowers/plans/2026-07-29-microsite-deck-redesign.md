# Microsite Deck Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 8-page Anton/brand-background microsite deck with a 9-page deck on DCN-Deck's design system (Fraunces + IBM Plex, white/ink/orange, accent-only brand color), adding proof-library case-study and 30-day-plan pages.

**Architecture:** The committed template becomes generated: an authored `templates/microsite/index.src.html` plus subset woff2 fonts are combined by `scripts/build-deck-template.ts` into the self-contained `templates/microsite/index.html` that `src/render.ts` reads. `pure/microsite.ts` gains a deterministic case-study picker and case/plan tokens, loses `pickReadableBrandBg`, and injects only `--brand-accent`. Spec: `docs/superpowers/specs/2026-07-29-microsite-deck-redesign-design.md`.

**Tech Stack:** TypeScript (tsx, vitest), Playwright PDF render, fonttools via `uv` for font subsetting, zod proof library.

## Global Constraints

- Paths contain spaces (`/Users/udaykang/ MicroSites Public/...`) — always quote in shell.
- Python tooling only via `uv` (`uvx`), never bare pip/python.
- Proof-library metric strings render verbatim — no code may rewrite `metrics[].value` / `metrics[].label`.
- The template must stay fully self-contained: no CDN links, no network fetches (Playwright `setContent` + `networkidle` must not hang).
- `src/pure/microsite.ts` stays pure (no I/O) and 100% unit-covered; tests change in lockstep in the same task as the code.
- No new per-lead AI calls.
- Commit style: short imperative subject (no `feat:` prefixes), body optional, then `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Test command: `npm test` (vitest run); typecheck: `npm run typecheck`.
- Repo root for all commands: `/Users/udaykang/ MicroSites Public/micrositepipelinepublic`.

---

### Task 1: Subset deck fonts to committed woff2

**Files:**
- Create: `scripts/subset-deck-fonts.sh`
- Create: `templates/microsite/fonts/*.woff2` (10 files, generated then committed)

**Interfaces:**
- Consumes: a local clone of https://github.com/udaykang-byte/DCN-Deck (TTFs in `fonts/`)
- Produces: exactly these 10 files under `templates/microsite/fonts/`, consumed by Task 2's `FONTS` table: `fraunces-300.woff2`, `fraunces-300i.woff2`, `fraunces-400.woff2`, `fraunces-400i.woff2`, `fraunces-600.woff2`, `fraunces-600i.woff2`, `plex-400.woff2`, `plex-500.woff2`, `plex-600.woff2`, `plex-cond-600.woff2`

- [ ] **Step 1: Clone the DCN-Deck reference** (skip if already present)

```bash
git clone --depth 1 https://github.com/udaykang-byte/DCN-Deck /tmp/DCN-Deck
```

- [ ] **Step 2: Write `scripts/subset-deck-fonts.sh`**

```bash
#!/usr/bin/env bash
# One-off: subset DCN-Deck's TTFs to latin woff2 for the deck template.
# Re-run only if the source fonts or the subset ranges change.
# Needs uv (uvx) and a clone of https://github.com/udaykang-byte/DCN-Deck.
# Usage: scripts/subset-deck-fonts.sh /path/to/DCN-Deck
set -euo pipefail
SRC_DIR="${1:?usage: subset-deck-fonts.sh /path/to/DCN-Deck}/fonts"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/templates/microsite/fonts"
mkdir -p "$OUT_DIR"
# Latin + en/em dash, curly quotes, ellipsis, rightwards arrow (CTA "→").
UNICODES="U+0000-00FF,U+2013-2014,U+2018-2019,U+201C-201D,U+2026,U+2192"
sub() {
  uvx --from "fonttools[woff]" pyftsubset "$SRC_DIR/$1" \
    --output-file="$OUT_DIR/$2" --flavor=woff2 \
    --layout-features='*' --unicodes="$UNICODES"
}
sub "Fraunces_72pt_SuperSoft-Light.ttf"          "fraunces-300.woff2"
sub "Fraunces_72pt_SuperSoft-LightItalic.ttf"    "fraunces-300i.woff2"
sub "Fraunces_72pt_SuperSoft-Regular.ttf"        "fraunces-400.woff2"
sub "Fraunces_72pt_SuperSoft-Italic.ttf"         "fraunces-400i.woff2"
sub "Fraunces_72pt_SuperSoft-SemiBold.ttf"       "fraunces-600.woff2"
sub "Fraunces_72pt_SuperSoft-SemiBoldItalic.ttf" "fraunces-600i.woff2"
sub "IBMPlexSans-Regular.ttf"            "plex-400.woff2"
sub "IBMPlexSans-Medium.ttf"             "plex-500.woff2"
sub "IBMPlexSans-SemiBold.ttf"           "plex-600.woff2"
sub "IBMPlexSans_Condensed-SemiBold.ttf" "plex-cond-600.woff2"
ls -la "$OUT_DIR"
```

- [ ] **Step 3: Run it**

```bash
chmod +x scripts/subset-deck-fonts.sh
./scripts/subset-deck-fonts.sh /tmp/DCN-Deck
```

Expected: 10 `.woff2` files listed, each roughly 10–40 KB (Fraunces variable-ish TTFs are ~100–400 KB before subsetting; if any output exceeds 100 KB, the subset flags did not apply — stop and investigate rather than committing megabytes).

- [ ] **Step 4: Commit**

```bash
git add scripts/subset-deck-fonts.sh templates/microsite/fonts
git commit -m "Add subset woff2 deck fonts (Fraunces + IBM Plex) and build script

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Author the 9-page template source + build script

**Files:**
- Create: `templates/microsite/index.src.html` (authored source, fonts as marker)
- Create: `scripts/build-deck-template.ts`
- Generate + commit: `templates/microsite/index.html`
- Delete: `templates/microsite/source-bundle.html`, `scripts/extract-template.ts`

**Interfaces:**
- Consumes: Task 1's woff2 files (exact names above).
- Produces: `templates/microsite/index.html` containing all tokens/slots consumed by Tasks 3–5:
  tokens `[LOGO_URL]`, `[Company]`, `[Point 1..4]`, `[Segment 1/2]`, `[Company Characteristic 1/2]`, `[Key Pain Point 1/2]`, `[Primary Buyer 1/2]`, `[Differentiating Need 1/2]`, `[Z]`, `[Y]`, `[X]`, `[Signal 1..3]`, `[CRM]`, `[Case Client 1/2]`, `[Case Problem 1/2]`, `[Case Approach 1/2]`, `[Case Metric Value 1/2]`, `[Case Metric Label 1/2]`, `[Plan Title 1..4]`, `[Plan Deliverables 1..4]`;
  data-slots `logo`, `point1`, `point2`, `work`, `case1`, `case2`, `plan30`, `plan-phase-1` … `plan-phase-4`.
- CSS var contract: `--brand-accent` is the ONLY per-lead var (Task 5 injects it); `--brand-primary`/`--brand-secondary` must not appear anywhere.

- [ ] **Step 1: Write `scripts/build-deck-template.ts`**

```ts
// Combines templates/microsite/index.src.html with the subset woff2 fonts
// into the self-contained templates/microsite/index.html that render.ts
// reads. Re-run after editing index.src.html or the fonts:
//   npx tsx scripts/build-deck-template.ts
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../templates/microsite/index.src.html");
const OUT = resolve(here, "../templates/microsite/index.html");
const FONT_DIR = resolve(here, "../templates/microsite/fonts");

const FONTS: Array<{ file: string; family: string; weight: number; style: "normal" | "italic" }> = [
  { file: "fraunces-300.woff2", family: "Fraunces", weight: 300, style: "normal" },
  { file: "fraunces-300i.woff2", family: "Fraunces", weight: 300, style: "italic" },
  { file: "fraunces-400.woff2", family: "Fraunces", weight: 400, style: "normal" },
  { file: "fraunces-400i.woff2", family: "Fraunces", weight: 400, style: "italic" },
  { file: "fraunces-600.woff2", family: "Fraunces", weight: 600, style: "normal" },
  { file: "fraunces-600i.woff2", family: "Fraunces", weight: 600, style: "italic" },
  { file: "plex-400.woff2", family: "IBM Plex Sans", weight: 400, style: "normal" },
  { file: "plex-500.woff2", family: "IBM Plex Sans", weight: 500, style: "normal" },
  { file: "plex-600.woff2", family: "IBM Plex Sans", weight: 600, style: "normal" },
  { file: "plex-cond-600.woff2", family: "IBM Plex Sans Condensed", weight: 600, style: "normal" },
];

const MARKER = "/*__DECK_FONTS__*/";

async function main(): Promise<void> {
  const src = await readFile(SRC, "utf8");
  if (!src.includes(MARKER)) throw new Error(`marker ${MARKER} missing in ${SRC}`);
  const faces = await Promise.all(
    FONTS.map(async (f) => {
      const data = await readFile(resolve(FONT_DIR, f.file));
      return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url("data:font/woff2;base64,${data.toString("base64")}") format("woff2");}`;
    })
  );
  const out = src.replace(MARKER, faces.join("\n"));
  await writeFile(OUT, out, "utf8");
  console.log(`wrote ${OUT} (${Math.round(out.length / 1024)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Write `templates/microsite/index.src.html`**

The complete authored template. Design system lifted from DCN-Deck (`styles.css` + inline styles), adapted for A4-landscape pagination: every `<section>` is one PDF page (`min-height:100vh` + break rules), content centered vertically, `.wrap` max-width 1040px. Where DCN used JetBrains Mono (CDN) for `.section-num`/`.num`, this uses IBM Plex Sans Condensed (self-contained rule).

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>A note for [Company]</title>
<style>
/*__DECK_FONTS__*/
:root {
  --orange: #FF5A2C;
  --ink: #0F1115;
  --paper: #FFFFFF;
  --fg-2: #2E323A;
  --fg-3: #6B707B;
  --line: #E2E5EA;
  --bg-2: #F7F8FA;
  --brand-accent: #FF5A2C; /* per-lead override appended before </body> when AA-safe */
  --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
  --font-body: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  --font-cond: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--paper); color: var(--ink); }
body {
  font-family: var(--font-body);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  text-rendering: optimizeLegibility;
}
img { display: block; max-width: 100%; }
a { color: inherit; text-decoration: none; }

section {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 6vh 6vw;
}
.wrap { width: 100%; max-width: 1040px; margin: 0 auto; }

.eyebrow, .section-num {
  font-family: var(--font-cond);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--brand-accent);
  margin-bottom: 16px;
}
h2 {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(28px, 3.4vw, 42px);
  line-height: 1.1;
  letter-spacing: -0.02em;
  margin-bottom: 14px;
  text-wrap: balance;
}
.deck {
  font-size: clamp(14px, 1.5vw, 17px);
  line-height: 1.6;
  color: var(--fg-2);
  max-width: 640px;
  margin-bottom: 40px;
}

/* ── 01 Cover ── */
.cover .lockup { display: flex; align-items: center; gap: 22px; margin-bottom: 7vh; }
.cover .lockup .me { font-family: var(--font-body); font-weight: 600; font-size: 20px; letter-spacing: -0.01em; }
.cover .lockup .x { font-family: var(--font-display); font-style: italic; font-size: 20px; color: var(--brand-accent); }
.cover .lockup img { height: 36px; width: auto; object-fit: contain; }
.cover h1 {
  font-family: var(--font-display);
  font-weight: 300;
  font-size: clamp(40px, 5.2vw, 64px);
  line-height: 1.07;
  letter-spacing: -0.022em;
  max-width: 22ch;
  margin-bottom: 5vh;
  text-wrap: balance;
}
.cover h1 em { font-style: italic; font-weight: 300; }
.cover .prepared { border-top: 1px solid var(--line); padding-top: 22px; max-width: 460px; }
.cover .prepared .who { font-weight: 600; font-size: 15px; }
.cover .prepared .tag { font-size: 15px; color: var(--fg-3); margin-top: 2px; }

/* ── 02 Reading: auto-renumbering rows ── */
.read-blocks { counter-reset: reading; }
.read-block {
  counter-increment: reading;
  display: grid;
  grid-template-columns: 56px 200px 1fr;
  gap: 28px;
  padding: 22px 0;
  border-top: 1px solid var(--line);
  align-items: start;
}
.read-block:last-child { border-bottom: 1px solid var(--line); }
.read-block .num::before { content: "0" counter(reading); }
.read-block .num {
  font-family: var(--font-cond);
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-3);
  padding-top: 3px;
  letter-spacing: 0.06em;
}
.read-block .label-col {
  font-family: var(--font-cond);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.read-block .label-col .sub { display: block; color: var(--brand-accent); margin-top: 4px; }
.read-block .body { font-size: clamp(14px, 1.6vw, 17px); line-height: 1.6; color: var(--fg-2); }

/* ── 03 ICP ── */
.icp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.icp-card { background: var(--bg-2); border: 1px solid var(--line); border-radius: 16px; padding: 26px 28px; }
.icp-card h3 {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: clamp(18px, 2vw, 22px);
  line-height: 1.2;
  letter-spacing: -0.01em;
  margin-bottom: 18px;
}
.icp-row { display: grid; grid-template-columns: 86px 1fr; gap: 14px; padding: 9px 0; border-top: 1px solid var(--line); }
.icp-row .k {
  font-family: var(--font-cond);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--brand-accent);
  padding-top: 3px;
}
.icp-row .v { font-size: clamp(13px, 1.4vw, 15px); line-height: 1.5; color: var(--fg-2); }

/* ── 04 Market funnel ── */
.funnel { display: flex; flex-direction: column; gap: 10px; }
.tier { border: 1px solid var(--line); border-radius: 12px; padding: 18px 28px; display: flex; align-items: baseline; gap: 24px; }
.tier .figure { font-family: var(--font-display); font-weight: 400; font-size: clamp(26px, 3.4vw, 44px); line-height: 1; }
.tier .desc { font-size: clamp(13px, 1.5vw, 16px); color: var(--fg-2); }
.tier-2 { width: 76%; background: var(--bg-2); }
.tier-3 { width: 52%; background: var(--ink); border-color: var(--ink); }
.tier-3 .figure { color: var(--brand-accent); }
.tier-3 .desc { color: rgba(255, 255, 255, 0.75); }
.footnote { margin-top: 26px; font-size: 12px; color: var(--fg-3); }

/* ── 05 Openings ── */
.openings { counter-reset: opening; }
.opening {
  counter-increment: opening;
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 30px;
  padding: 26px 0;
  border-top: 1px solid var(--line);
  align-items: start;
}
.opening:last-child { border-bottom: 1px solid var(--line); }
.opening .num::before { content: "0" counter(opening); }
.opening .num { font-family: var(--font-display); font-weight: 300; font-size: clamp(28px, 3vw, 40px); line-height: 1; color: var(--brand-accent); }
.opening .body { font-size: clamp(15px, 1.7vw, 18px); line-height: 1.6; color: var(--fg-2); }

/* ── 06 Stack ── */
.stack p.pitch { font-size: clamp(15px, 1.7vw, 18px); line-height: 1.65; color: var(--fg-2); max-width: 58ch; margin-bottom: 36px; }
.stack p.pitch strong { color: var(--ink); font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 10px; }
.chip {
  font-family: var(--font-cond);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 1px solid var(--ink);
  border-radius: 999px;
  padding: 10px 20px;
}

/* ── 07 Work ── */
.cases { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.case { border: 1px solid var(--line); border-radius: 16px; padding: 26px 28px; display: flex; flex-direction: column; gap: 12px; }
.case .client {
  font-family: var(--font-cond);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--brand-accent);
}
.case h3 {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: clamp(17px, 2vw, 22px);
  line-height: 1.2;
  letter-spacing: -0.015em;
  text-wrap: balance;
}
.case .approach { font-size: clamp(12px, 1.35vw, 14px); line-height: 1.6; color: var(--fg-2); }
.case .metric { margin-top: auto; background: var(--bg-2); border-radius: 12px; padding: 14px 16px; }
.case .metric .figure { font-family: var(--font-display); font-weight: 600; font-size: clamp(22px, 2.6vw, 32px); line-height: 1.1; color: var(--brand-accent); margin-bottom: 4px; }
.case .metric .desc { font-family: var(--font-cond); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--fg-3); }

/* ── 08 Thirty days (dark) ── */
.plan { background: var(--ink); color: #fff; }
.plan h2 { color: #fff; }
.plan .deck { color: rgba(255, 255, 255, 0.65); }
.days { display: grid; grid-template-columns: repeat(4, 1fr); gap: 22px; }
.day { border-top: 2px solid rgba(255, 255, 255, 0.9); padding-top: 16px; }
.day .num {
  font-family: var(--font-cond);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--brand-accent);
  margin-bottom: 10px;
}
.day p { font-size: clamp(12px, 1.35vw, 14px); line-height: 1.6; color: rgba(255, 255, 255, 0.65); }

/* ── 09 Close ── */
.close { background: var(--bg-2); }
.close .pull {
  font-family: var(--font-display);
  font-weight: 300;
  font-size: clamp(30px, 4vw, 48px);
  line-height: 1.15;
  letter-spacing: -0.015em;
  max-width: 20ch;
  margin-bottom: 28px;
  text-wrap: balance;
}
.close .pull em { font-style: italic; font-weight: 400; }
.close p.next { font-size: clamp(14px, 1.6vw, 17px); line-height: 1.65; color: var(--fg-2); max-width: 56ch; margin-bottom: 34px; }
.btn-primary {
  display: inline-block;
  font-weight: 500;
  font-size: 15px;
  padding: 14px 28px;
  background: var(--orange);
  color: #fff;
  border-radius: 999px;
  box-shadow: 0 8px 24px rgba(255, 90, 44, 0.20);
}
.signature { margin-top: 7vh; padding-top: 22px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: flex-end; }
.signature .name { font-family: var(--font-display); font-style: italic; font-size: 22px; }
.signature .sig-meta { font-family: var(--font-cond); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--fg-3); text-align: right; }

@page { size: A4 landscape; margin: 0; }
@media print {
  html, body { background: #fff; }
  section {
    break-after: page;
    page-break-after: always;
    break-inside: avoid;
    page-break-inside: avoid;
    min-height: 100vh;
    height: 100vh;
    overflow: hidden;
  }
  section:last-of-type { break-after: auto; page-break-after: auto; }
}
</style>
</head>
<body>

<!-- ══ 01 / COVER ══ -->
<section class="cover" data-label="Cover" data-screen-label="01 Cover">
  <div class="wrap">
    <div class="lockup">
      <div class="me">automatewith<span style="color:var(--orange);">uday</span></div>
      <div data-slot="logo" style="display:flex;align-items:center;gap:22px;">
        <div class="x">x</div>
        <img src="[LOGO_URL]" alt="[Company] logo">
      </div>
    </div>
    <div class="eyebrow">A note for [Company]</div>
    <h1>Where [Company]'s pipeline could go, <em>and what changes in the first thirty days.</em></h1>
    <div class="prepared">
      <div class="who">Prepared by Uday Singh Kang.</div>
      <div class="tag">GTM Engineering, not GTM guesswork.</div>
    </div>
  </div>
</section>

<!-- ══ 02 / READING ══ -->
<section data-label="Reading" data-screen-label="02 Reading">
  <div class="wrap">
    <div class="section-num">02 / Reading</div>
    <h2>How I'm reading [Company].</h2>
    <p class="deck">Four things in the public data worth acting on. Each one shaped this note.</p>
    <div class="read-blocks">
      <div class="read-block" data-slot="point1">
        <div class="num"></div>
        <div class="label-col">Traffic<span class="sub">Paid search</span></div>
        <div class="body">[Point 1]</div>
      </div>
      <div class="read-block" data-slot="point2">
        <div class="num"></div>
        <div class="label-col">Founder<span class="sub">LinkedIn reach</span></div>
        <div class="body">[Point 2]</div>
      </div>
      <div class="read-block">
        <div class="num"></div>
        <div class="label-col">Ads<span class="sub">Paid footprint</span></div>
        <div class="body">[Point 3]</div>
      </div>
      <div class="read-block">
        <div class="num"></div>
        <div class="label-col">Team<span class="sub">Sales capacity</span></div>
        <div class="body">[Point 4]</div>
      </div>
    </div>
  </div>
</section>

<!-- ══ 03 / ICP ══ -->
<section data-label="ICP" data-screen-label="03 ICP">
  <div class="wrap">
    <div class="section-num">03 / ICP</div>
    <h2>Who [Company] should be selling to.</h2>
    <p class="deck">Two segments where the pain is sharpest and the buyer is reachable.</p>
    <div class="icp-grid">
      <div class="icp-card">
        <h3>[Segment 1]</h3>
        <div class="icp-row"><div class="k">Profile</div><div class="v">[Company Characteristic 1]</div></div>
        <div class="icp-row"><div class="k">Pain</div><div class="v">[Key Pain Point 1]</div></div>
        <div class="icp-row"><div class="k">Buyer</div><div class="v">[Primary Buyer 1]</div></div>
        <div class="icp-row"><div class="k">Need</div><div class="v">[Differentiating Need 1]</div></div>
      </div>
      <div class="icp-card">
        <h3>[Segment 2]</h3>
        <div class="icp-row"><div class="k">Profile</div><div class="v">[Company Characteristic 2]</div></div>
        <div class="icp-row"><div class="k">Pain</div><div class="v">[Key Pain Point 2]</div></div>
        <div class="icp-row"><div class="k">Buyer</div><div class="v">[Primary Buyer 2]</div></div>
        <div class="icp-row"><div class="k">Need</div><div class="v">[Differentiating Need 2]</div></div>
      </div>
    </div>
  </div>
</section>

<!-- ══ 04 / MARKET ══ -->
<section data-label="Market" data-screen-label="04 Market">
  <div class="wrap">
    <div class="section-num">04 / Market</div>
    <h2>The market is bigger than your pipeline.</h2>
    <p class="deck">Sized from public market data and your positioning.</p>
    <div class="funnel">
      <div class="tier tier-1"><div class="figure">[Z]</div><div class="desc">companies match your ICP</div></div>
      <div class="tier tier-2"><div class="figure">[Y]</div><div class="desc">companies reachable with clean data</div></div>
      <div class="tier tier-3"><div class="figure">[X]</div><div class="desc">companies worth pursuing this year</div></div>
    </div>
    <p class="footnote">Estimates, not audits — the point is the order of magnitude.</p>
  </div>
</section>

<!-- ══ 05 / OPENINGS ══ -->
<section data-label="Openings" data-screen-label="05 Openings">
  <div class="wrap">
    <div class="section-num">05 / Openings</div>
    <h2>Three openings I'd act on in week one.</h2>
    <p class="deck">Live signals, not hypotheticals. Each one maps to a play that ships in days.</p>
    <div class="openings">
      <div class="opening"><div class="num"></div><div class="body">[Signal 1]</div></div>
      <div class="opening"><div class="num"></div><div class="body">[Signal 2]</div></div>
      <div class="opening"><div class="num"></div><div class="body">[Signal 3]</div></div>
    </div>
  </div>
</section>

<!-- ══ 06 / STACK ══ -->
<section class="stack" data-label="Stack" data-screen-label="06 Stack">
  <div class="wrap">
    <div class="section-num">06 / Stack</div>
    <h2>Runs inside [CRM], not beside it.</h2>
    <p class="pitch">The engine is built in your stack. Your workspace, your seats, your data. Enrichment, scoring, and outbound flow straight into <strong>[CRM]</strong> — nothing held hostage in my tools.</p>
    <div class="chips">
      <div class="chip">Supabase</div>
      <div class="chip">Claude Code</div>
      <div class="chip">Apify</div>
      <div class="chip">Smartlead</div>
    </div>
  </div>
</section>

<!-- ══ 07 / WORK ══ -->
<section data-label="Work" data-screen-label="07 Work" data-slot="work">
  <div class="wrap">
    <div class="section-num">07 / Work</div>
    <h2>The work, where it's relevant.</h2>
    <p class="deck">Picked for relevance to [Company]. Full case studies on the call.</p>
    <div class="cases">
      <article class="case" data-slot="case1">
        <div class="client">[Case Client 1]</div>
        <h3>[Case Problem 1]</h3>
        <p class="approach">[Case Approach 1]</p>
        <div class="metric">
          <div class="figure">[Case Metric Value 1]</div>
          <div class="desc">[Case Metric Label 1]</div>
        </div>
      </article>
      <article class="case" data-slot="case2">
        <div class="client">[Case Client 2]</div>
        <h3>[Case Problem 2]</h3>
        <p class="approach">[Case Approach 2]</p>
        <div class="metric">
          <div class="figure">[Case Metric Value 2]</div>
          <div class="desc">[Case Metric Label 2]</div>
        </div>
      </article>
    </div>
  </div>
</section>

<!-- ══ 08 / THIRTY DAYS ══ -->
<section class="plan" data-label="Plan" data-screen-label="08 Thirty days" data-slot="plan30">
  <div class="wrap">
    <div class="section-num">08 / Onboarding</div>
    <h2>What the first thirty days look like.</h2>
    <p class="deck">Concrete output, not orientation.</p>
    <div class="days">
      <div class="day" data-slot="plan-phase-1"><div class="num">01 / [Plan Title 1]</div><p>[Plan Deliverables 1]</p></div>
      <div class="day" data-slot="plan-phase-2"><div class="num">02 / [Plan Title 2]</div><p>[Plan Deliverables 2]</p></div>
      <div class="day" data-slot="plan-phase-3"><div class="num">03 / [Plan Title 3]</div><p>[Plan Deliverables 3]</p></div>
      <div class="day" data-slot="plan-phase-4"><div class="num">04 / [Plan Title 4]</div><p>[Plan Deliverables 4]</p></div>
    </div>
  </div>
</section>

<!-- ══ 09 / CLOSE ══ -->
<section class="close" data-label="Close" data-screen-label="09 Close">
  <div class="wrap">
    <div class="section-num">09 / Close</div>
    <div class="pull">Let's build this <em>for [Company].</em></div>
    <p class="next">15 minutes. I'll walk through this exact data live and show what the first thirty days look like inside your stack.</p>
    <div><a class="btn-primary" href="https://cal.com/uday-kang/15min">Book 15 minutes →</a></div>
    <div class="signature">
      <div class="name">Uday Kang</div>
      <div class="sig-meta">GTM Engineering<br>Martechs · martechs.io</div>
    </div>
  </div>
</section>

</body>
</html>
```

- [ ] **Step 3: Build and sanity-check the output**

```bash
npx tsx scripts/build-deck-template.ts
grep -c "@font-face" templates/microsite/index.html          # expect 10
grep -c "data-slot" templates/microsite/index.html           # expect 10
grep -c "brand-primary\|brand-secondary" templates/microsite/index.html || true  # expect 0
```

- [ ] **Step 4: Visual smoke check (screen + print)**

```bash
npx tsx -e "
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const html = readFileSync('templates/microsite/index.html', 'utf8');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1123, height: 794 } });
await p.setContent(html, { waitUntil: 'networkidle' });
const pdf = await p.pdf({ format: 'A4', printBackground: true, landscape: true });
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log('pdf pages:', pages);
await p.screenshot({ path: '/tmp/deck-cover.png' });
await b.close();
"
```

Expected: `pdf pages: 9` (raw template with `[tokens]` visible is fine here). Read `/tmp/deck-cover.png` and confirm Fraunces renders (serif headline, not Georgia fallback — Fraunces' rounded terminals are visually distinct) and the layout matches the cover design. If pages > 9, a section overflows: reduce that section's paddings/font clamps until it fits.

- [ ] **Step 5: Delete the obsolete extraction path**

```bash
git rm templates/microsite/source-bundle.html scripts/extract-template.ts
```

- [ ] **Step 6: Commit**

```bash
git add templates/microsite/index.src.html templates/microsite/index.html scripts/build-deck-template.ts
git commit -m "Rebuild microsite deck template on DCN design system (9 pages)

Replaces the Claude Design bundle extraction (source-bundle.html +
extract-template.ts) with an authored index.src.html + font-inlining
build script. Brand color is accent-only via --brand-accent.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Deterministic case-study picker

**Files:**
- Modify: `src/pure/microsite.ts`
- Test: `src/pure/microsite.test.ts`

**Interfaces:**
- Consumes: `ProofLibrary` type from `./proofLibrary.js` (`import type { ProofLibrary } from "./proofLibrary.js";`).
- Produces: `export function pickDeckCaseStudies(lib: ProofLibrary, industry: string | null): ProofLibrary["caseStudies"]` — up to 2 case studies; industry-matched first (curated order preserved), then curated order. Task 4 calls this.

- [ ] **Step 1: Write the failing tests** (append to `src/pure/microsite.test.ts`; a minimal lib fixture — `plays`/`platforms`/`plan30day`/`profile` can be minimal valid shapes since the picker only reads `caseStudies`)

```ts
import { pickDeckCaseStudies } from "./microsite.js";
import type { ProofLibrary } from "./proofLibrary.js";

function lib(cases: Array<Partial<ProofLibrary["caseStudies"][number]> & { id: string }>): ProofLibrary {
  return {
    profile: { positioning: "p" },
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pure/microsite.test.ts -t pickDeckCaseStudies`
Expected: FAIL — `pickDeckCaseStudies` is not exported.

- [ ] **Step 3: Implement in `src/pure/microsite.ts`** (below `pickThemedLogoUrl`)

```ts
// ---------------------------------------------------------------------
// Deck case-study pick. Deterministic, no AI: case studies whose
// verticalTags match the lead's industry come first (curated order
// preserved within each group), the rest fill from curated order.
// ---------------------------------------------------------------------

import type { ProofLibrary } from "./proofLibrary.js";

export function pickDeckCaseStudies(
  lib: ProofLibrary,
  industry: string | null
): ProofLibrary["caseStudies"] {
  const ind = (industry ?? "").trim().toLowerCase();
  const matches = (c: ProofLibrary["caseStudies"][number]): boolean =>
    ind !== "" &&
    c.verticalTags.some((t) => {
      const tag = t.trim().toLowerCase();
      return tag !== "" && (tag.includes(ind) || ind.includes(tag));
    });
  const matched = lib.caseStudies.filter(matches);
  const rest = lib.caseStudies.filter((c) => !matches(c));
  return [...matched, ...rest].slice(0, 2);
}
```

(Move the `import type` up to the file's import block — imports live at the top.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/pure/microsite.test.ts -t pickDeckCaseStudies`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pure/microsite.ts src/pure/microsite.test.ts
git commit -m "Add deterministic industry-matched deck case-study picker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Case/plan tokens + degradation in buildMicrositeHtml

**Files:**
- Modify: `src/pure/microsite.ts` (`buildMicrositeHtml`)
- Test: `src/pure/microsite.test.ts`

**Interfaces:**
- Consumes: `pickDeckCaseStudies` (Task 3), `removeSlot`, `escapeHtml` (existing).
- Produces: `buildMicrositeHtml(lead: LeadRow, templateHtml: string, library: ProofLibrary | null = null): string`. New tokens `[Case Client 1/2]`, `[Case Problem 1/2]`, `[Case Approach 1/2]`, `[Case Metric Value 1/2]`, `[Case Metric Label 1/2]`, `[Plan Title 1..4]`, `[Plan Deliverables 1..4]`; slots `work`/`case1`/`case2`/`plan30`/`plan-phase-1..4` removed per degradation rules. Task 6 passes the library from `render.ts`.

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe("buildMicrositeHtml")`; extend `FAKE_TEMPLATE` first)

Replace `FAKE_TEMPLATE`'s line `<section data-label="Proof">STATIC PROOF 2,700+ $250K</section>` with:

```html
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
```

Then add a library fixture and tests (reuse the `lib()` helper from Task 3 — hoist it to file scope next to `baseLead` if it was defined inside the picker describe):

```ts
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
} as ProofLibrary;

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pure/microsite.test.ts -t buildMicrositeHtml`
Expected: new tests FAIL (extra argument ignored is not enough — tokens/slots survive); pre-existing tests still pass.

- [ ] **Step 3: Implement in `buildMicrositeHtml`**

Signature: `export function buildMicrositeHtml(lead: LeadRow, templateHtml: string, library: ProofLibrary | null = null): string`.

Insert after the existing point1/point2/logo `removeSlot` block (order matters: slot removal before token replacement, same as today):

```ts
  // 1b. Library-driven pages. Industry steers the case pick; a missing or
  //     empty library drops the Work and Plan pages entirely (removeSlot),
  //     so the deck degrades instead of rendering dangling [tokens].
  const companyData = lead.company_data as { merged?: { industry?: unknown } } | null | undefined;
  const mergedForIndustry = isRecord(companyData?.merged) ? companyData.merged : undefined;
  const industry =
    typeof mergedForIndustry?.industry === "string" && mergedForIndustry.industry.length > 0
      ? mergedForIndustry.industry
      : null;

  const cases = library && library.caseStudies.length > 0 ? pickDeckCaseStudies(library, industry) : [];
  if (cases.length === 0) {
    html = removeSlot(html, "work");
  } else if (cases.length === 1) {
    html = removeSlot(html, "case2");
  }

  const phases = library ? library.plan30day.slice(0, 4) : [];
  if (phases.length === 0) {
    html = removeSlot(html, "plan30");
  } else {
    for (let i = phases.length; i < 4; i++) {
      html = removeSlot(html, `plan-phase-${i + 1}`);
    }
  }
```

And extend the `replacements` array (before the loop; `[Case ...]`/`[Plan ...]` share no prefix with existing tokens, so ordering within the list is free):

```ts
  for (const [i, c] of cases.entries()) {
    const n = i + 1;
    const metric = c.metrics[0];
    replacements.push(
      [`[Case Client ${n}]`, e(c.client)],
      [`[Case Problem ${n}]`, e(c.problem)],
      [`[Case Approach ${n}]`, e(c.approach)],
      [`[Case Metric Value ${n}]`, e(metric?.value ?? "")],
      [`[Case Metric Label ${n}]`, e(metric?.label ?? "")]
    );
  }
  for (const [i, p] of phases.entries()) {
    const n = i + 1;
    replacements.push([`[Plan Title ${n}]`, e(p.title)], [`[Plan Deliverables ${n}]`, e(p.deliverables.join(" "))]);
  }
```

(`replacements` is currently `const ... : Array<[string, string]>` — `push` works as-is.)

- [ ] **Step 4: Run the full microsite suite**

Run: `npx vitest run src/pure/microsite.test.ts`
Expected: PASS, including all pre-existing tests (default `library = null` must not break them — they now exercise the removed-work/plan path; any old test asserting on the deleted `STATIC PROOF` fixture line needs its assertion updated to the new fixture).

- [ ] **Step 5: Commit**

```bash
git add src/pure/microsite.ts src/pure/microsite.test.ts
git commit -m "Render proof-library case studies and 30-day plan in the deck

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Accent-only brand color; delete pickReadableBrandBg

**Files:**
- Modify: `src/pure/microsite.ts`
- Test: `src/pure/microsite.test.ts`

**Interfaces:**
- Consumes: existing `pickReadableAccent`, `pickThemedLogoUrl`.
- Produces: `buildMicrositeHtml` appends `<style>:root{--brand-accent: <hex>;}</style>` before `</body>` only when `pickReadableAccent` passes; never writes `--brand-primary`/`--brand-secondary`; logo always resolved with `pickThemedLogoUrl(logo, null)`. `pickReadableBrandBg` no longer exists.

- [ ] **Step 1: Write the failing tests**

Delete the whole `describe("pickReadableBrandBg")` block and its import. Add inside `describe("buildMicrositeHtml")`:

```ts
it("injects --brand-accent when a brand color is dark enough to read on white", () => {
  const out = buildMicrositeHtml(
    lead({ brand_colors: { primary: "#0B7BFA", secondary: "" } }),
    FAKE_TEMPLATE
  );
  expect(out).toContain(":root{--brand-accent: #0B7BFA;}");
  expect(out.indexOf("--brand-accent: #0B7BFA")).toBeGreaterThan(out.indexOf("<body>"));
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pure/microsite.test.ts`
Expected: FAIL — the accent tests (current code injects `--brand-primary`), plus a compile error until the `pickReadableBrandBg` import is gone from the test file.

- [ ] **Step 3: Implement**

In `buildMicrositeHtml`:
- Delete the `pickReadableBrandBg` call, `CREAM_DEFAULT`, and `effectiveBg`; resolve the logo as `const logoUrl = pickThemedLogoUrl(isRecord(lead.logo) ? lead.logo : {}, null);`.
- Replace the step-3 injection block with:

```ts
  // 3. Brand accent injection. The deck's pages are always white/paper; the
  //    prospect's brand color may only tint small accents (--brand-accent),
  //    and only when it reads on white (AA >= 4.5). Appended at the end of
  //    the document so it wins the template's :root default.
  const accent = pickReadableAccent(d.brandPrimary, d.brandSecondary);
  if (accent) {
    const style = `<style>:root{--brand-accent: ${accent};}</style>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${style}</body>`) : html + style;
  }
```

Then delete the `pickReadableBrandBg` function itself and update the file's header comment (it mentions brand-color selection semantics). Keep `contrastVsText`/`TEXT_LUM` only if still referenced — after this change they are dead; delete them too.

- [ ] **Step 4: Run the full suite + typecheck** (catches the dead-code exports and `followup.ts`, which imports only `pickReadableAccent`/`pickThemedLogoUrl` and must be unaffected)

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/pure/microsite.ts src/pure/microsite.test.ts
git commit -m "Brand color is accent-only in the deck; delete pickReadableBrandBg

A light brand color can no longer become a page background — the
pink-Signaliz failure class is structurally impossible.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the proof library into render.ts

**Files:**
- Modify: `src/render.ts` (import block, template-missing error message, `buildMicrositeHtml` call around line 61)

**Interfaces:**
- Consumes: `loadProofLibrary(): ProofLibrary` (sync, throws) from `./proofLibrary.js`; Task 4's 3-arg `buildMicrositeHtml`.
- Produces: the render step passes a library (or null on any load failure) — deck degradation instead of a step error.

- [ ] **Step 1: Edit `src/render.ts`**

```ts
import { loadProofLibrary } from "./proofLibrary.js";
import type { ProofLibrary } from "./pure/proofLibrary.js";
```

Update the template-missing error message (`extract-template.ts` no longer exists):

```ts
    const templateHtml = await readFile(TEMPLATE_PATH, "utf8").catch(() => {
      throw new Error(
        `microsite template missing at ${TEMPLATE_PATH}. Run scripts/build-deck-template.ts to regenerate it.`
      );
    });
```

Replace the build call:

```ts
    // Library failures degrade the deck (Work/Plan pages drop) instead of
    // erroring the whole render step — the library is optional content.
    let library: ProofLibrary | null = null;
    try {
      library = loadProofLibrary();
    } catch {
      library = null;
    }
    const html = buildMicrositeHtml(lead, templateHtml, library);
```

Also update the file's header comment: "renders an 8-page PDF" → "renders a 9-page PDF".

- [ ] **Step 2: Verify**

Run: `npm test && npm run typecheck`
Expected: all green (render.ts has no unit tests of its own; typecheck is the gate here).

- [ ] **Step 3: Commit**

```bash
git add src/render.ts
git commit -m "Pass the proof library into the deck render, degrading on load failure

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Acceptance — re-render the two failing leads + overflow probe

**Files:**
- No new committed files (renders update `output/` and local state; a throwaway probe script runs via `tsx -e`).

**Interfaces:**
- Consumes: everything above; leads `aacab760-31ab-45ce-801e-c526caac1fac` (Signaliz) and `9592b080-e637-4169-9435-aab8613e68c7` (ColdIQ) in `local.db`.

- [ ] **Step 1: Re-render both known-bad leads**

```bash
npx tsx scripts/run.ts --lead aacab760-31ab-45ce-801e-c526caac1fac --force --step render
npx tsx scripts/run.ts --lead 9592b080-e637-4169-9435-aab8613e68c7 --force --step render
```

Expected: both complete without a step error. (ColdIQ env quirks: this step needs no external APIs — render is local-only.)

- [ ] **Step 2: Check page counts**

```bash
npx tsx -e "
import { readFileSync } from 'node:fs';
for (const id of ['aacab760-31ab-45ce-801e-c526caac1fac', '9592b080-e637-4169-9435-aab8613e68c7']) {
  const b = readFileSync(\`output/\${id}.pdf\`);
  const n = (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(id, 'pages:', n);
}
"
```

Expected: `pages: 9` for both. More than 9 = a section overflowed its A4 page — find it by screenshotting each section (Step 4) and tighten that section's clamps/paddings in `index.src.html`, rebuild (`npx tsx scripts/build-deck-template.ts`), re-render.

- [ ] **Step 3: Overflow probe with a max-length synthetic lead**

```bash
npx tsx -e "
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { buildMicrositeHtml } from './src/pure/microsite.js';
import { loadProofLibrary } from './src/proofLibrary.js';
const L = (n) => 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor. '.repeat(n).trim();
const lead = {
  id: 'synthetic', company: 'Synthetic Maximum Length Company Name Incorporated', qualified: true, step_status: {},
  tam: { tamEstimation: 2000000 },
  icp_segments: { segments: [
    { segmentName: 'Mid-market B2B SaaS platforms with distributed revenue teams', companyCharacteristic: L(2), keyPainPoint: L(2), primaryBuyer: L(1), differentiatingNeed: L(2) },
    { segmentName: 'Enterprise financial services and payroll infrastructure', companyCharacteristic: L(2), keyPainPoint: L(2), primaryBuyer: L(1), differentiatingNeed: L(2) },
  ] },
  sales_signals: { signals: [L(3), L(3), L(3)] },
  logo: { url: '' },
  brand_colors: { primary: '#F8C8DC', secondary: '#FFF0F5' },
  company_data: { merged: { name: 'Synthetic Maximum Length Company Name Incorporated', industry: 'SaaS' } },
  derived: { paidSearchPct: L(3), liFollowersInsight: L(3), adSummary: L(3), sdrInsight: L(3),
    crmPlatform: 'HubSpot', adjustedTam: '1,800,000', adjustedTam2: '1,200,000' },
};
const html = buildMicrositeHtml(lead, readFileSync('templates/microsite/index.html', 'utf8'), loadProofLibrary());
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent(html, { waitUntil: 'networkidle' });
const pdf = await p.pdf({ format: 'A4', printBackground: true, landscape: true });
const n = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log('synthetic pages:', n);
writeFileSync('/tmp/deck-synthetic.pdf', pdf);
await b.close();
"
```

Expected: `synthetic pages: 9`. If a page overflows at these lengths, tighten the offending section (the `overflow: hidden` print rule means real-world slightly-long content clips rather than reflows — clipping mid-word at 3× typical length is acceptable; extra pages are not).

- [ ] **Step 4: Visual review**

Screenshot every section of the Signaliz render at A4-landscape viewport and read them:

```bash
npx tsx -e "
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const html = readFileSync('output/aacab760-31ab-45ce-801e-c526caac1fac.html', 'utf8');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1123, height: 794 } });
await p.setContent(html, { waitUntil: 'networkidle' });
const sections = await p.locator('section').all();
for (let i = 0; i < sections.length; i++) await sections[i].screenshot({ path: \`/tmp/deck-p\${i + 1}.png\` });
await b.close(); console.log('wrote', sections.length, 'screenshots');
"
```

Read each `/tmp/deck-p*.png` and verify: headers legible on every page, no pink anywhere, page 8 dark with readable white text, logo visible on the cover (Signaliz has a logo), no clipped text at real content lengths.

- [ ] **Step 5: Report to the user**

Present the screenshots/PDFs for Uday's sign-off (deck look = human decision). Do NOT deploy or push anything; local artifacts only.

---

## Self-Review Notes

- Spec coverage: fonts (T1), template + build mechanism + old-path deletion (T2), picker (T3), tokens/degradation (T4), accent-only color + brand-bg deletion + logo (T5), render wiring + error message (T6), acceptance on both bad leads + synthetic overflow probe (T7). Roster-site variant explicitly out of scope.
- The `renderGate` is intentionally untouched (spec: unchanged).
- Type consistency checked: `ProofLibrary["caseStudies"][number]`, 3-arg `buildMicrositeHtml` default `null`, slot names `work/case1/case2/plan30/plan-phase-N` identical in template (T2), tests (T4), and builder (T4).
