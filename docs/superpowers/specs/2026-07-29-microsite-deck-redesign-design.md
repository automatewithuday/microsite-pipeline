# Microsite Deck Redesign — DCN Design System, 9-Page Structure

**Date:** 2026-07-29
**Status:** Approved structure + mechanics; spec pending user review
**Replaces:** `templates/microsite/index.html` (the Anton/Playfair deck with
full-page brand backgrounds that produced the unreadable pink Signaliz and
ColdIQ PDFs)

## Goal

Rebuild the per-lead microsite deck on the design system of
[automatewithuday/DCN-Deck](https://github.com/automatewithuday/DCN-Deck): Fraunces
display serif + IBM Plex Sans, white/ink/signal-orange, first-person
founder-led voice, ending with a 30-day plan before the ask. Roster-site's
Signal system is a separate, later template variant — out of scope here.

Success criteria:

1. The Signaliz (`aacab760`) and ColdIQ (`9592b080`) leads render to readable,
   on-brand HTML + A4-landscape PDFs.
2. A light/pink prospect brand color can never become a page background.
3. No new per-lead AI calls or API cost.
4. `pure/microsite.ts` stays 100% unit-covered; tests updated in lockstep.

## Page structure (9 sections, one per PDF page)

| # | Label | Headline (voice: first-person "I") | Data |
|---|-------|------------------------------------|------|
| 1 | Cover | "Where **[Company]**'s pipeline could go, *and what changes in the first thirty days.*" + "Prepared by Uday Singh Kang. GTM Engineering, not GTM guesswork." | company, logo |
| 2 | Reading | "How I'm reading **[Company]**." | [Point 1..4] (paid search %, founder LI, ads, SDR) |
| 3 | ICP | "Who **[Company]** should be selling to." | 2 segments × profile/pain/buyer/need |
| 4 | Market | "The market is bigger than your pipeline." | TAM funnel [Z]/[Y]/[X] |
| 5 | Openings | "Three openings I'd act on in week one." | [Signal 1..3] |
| 6 | Stack | "Runs inside **[CRM]**, not beside it." | crm.platform + tool chips |
| 7 | Work | "The work, where it's relevant." | proof-library case studies (verbatim metrics) |
| 8 | Thirty days | "What the first thirty days look like." | proof-library `plan30day` (Audit/Architect/Automate/Align) |
| 9 | Close | "Let's build this for **[Company]**." | cal.com/uday-kang/15min CTA |

## Template architecture

- One self-contained file: `templates/microsite/index.html`. 9 `<section>`
  pages, `min-height:100vh`, existing print CSS retained (`@page { size: A4
  landscape; margin: 0 }`, `break-after: page` per section) so the same file
  serves the hosted scroller and the PDF render.
- DCN-Deck's `styles.css` system (type scale, eyebrows, hairline rules,
  spacing, `--fs-*`/`--sp-*` vars) inlined and trimmed to what the deck uses.
- Fonts embedded as base64 **woff2**, subsetted to latin from DCN-Deck's TTFs
  via `uv`-run `fonttools` (one-off build script under `scripts/`, committed
  output only):
  - Fraunces 72pt SuperSoft 300/400/600 + italics (display)
  - IBM Plex Sans 400/500/600 (body)
  - IBM Plex Sans Condensed 600 (eyebrows/labels)
  - No JetBrains Mono (DCN loads it from a CDN; the deck must stay
    self-contained — use Plex Condensed where DCN used mono labels).
- Target file size: same order as the current template (~1.7MB) or smaller.

## Data contract

### Unchanged tokens/slots

`[LOGO_URL]`, `[Company]`, `[Point 1..4]`, `[Segment 1/2]`,
`[Company Characteristic 1/2]`, `[Key Pain Point 1/2]`, `[Primary Buyer 1/2]`,
`[Differentiating Need 1/2]`, `[Z]/[Y]/[X]`, `[Signal 1..3]`, `[CRM]`;
data-slots `logo`, `point1`, `point2` with existing `removeSlot` semantics.
`renderGate` unchanged.

### New tokens/slots (pages 7–8)

- Case studies (2 cards, DCN work-card shape: client, problem, approach, lead
  metric): `[Case Client 1/2]`, `[Case Problem 1/2]`, `[Case Approach 1/2]`,
  `[Case Metric Value 1/2]`, `[Case Metric Label 1/2]`. Lead metric = first
  entry in the case study's `metrics` array, rendered verbatim (library rule:
  no code or prompt may rewrite metric strings).
- Plan phases (4 columns/rows): `[Plan Title 1..4]`, `[Plan Deliverables 1..4]`
  (each phase's deliverables joined as one paragraph; current library has one
  deliverable per phase).
- Data-slots for degradation: `case1`, `case2` (per-card), `work` (page 7),
  `plan30` (page 8).

### Case-study selection (deterministic, no AI)

New pure function `pickDeckCaseStudies(lib, industry): [CaseStudy, CaseStudy]`:

1. Score each case study by whether any `verticalTags` entry matches the
   lead's `company_data.merged.industry` (case-insensitive substring match in
   either direction).
2. Take matching ones first (curated order preserved), fill remaining from
   curated order.
3. `industry` missing/null → first two in curated order (today's DailyPay +
   reactivation cards).

### Degradation rules

- Proof library load fails or `caseStudies.length < 2`: matching card slots
  removed; zero usable cards → whole `work` section removed.
- `plan30day` missing/empty (schema requires ≥1, but guard anyway): `plan30`
  section removed. Fewer than 4 phases → render what exists, remove unused
  phase slots (each phase gets slot `plan-phase-1..4`).
- Deck must still render with library entirely absent — same spirit as the
  existing partial-key degradation.

### Renderer changes

- `buildMicrositeHtml(lead, templateHtml)` gains a third parameter:
  `library: ProofLibrary | null`. The caller (`src/render.ts:61`) loads it via
  the existing `loadProofLibrary()` used by `followupRender.ts`, passing null
  on load failure.
- `extractMicrositeData` unchanged in shape except additions; existing fields
  keep their extractors.

## Color and logo safety

- **Delete** `pickReadableBrandBg` and its tests (after this change it has no
  callers; `followup.ts` already uses the accent path).
- Template ships `--ink/--paper(white)/--orange(#FF5A2C)` fixed. Prospect
  brand color goes only into `--brand-accent` (used for section numbers and
  headline italics) via the existing `pickReadableAccent(primary, secondary)`
  — AA vs white — else the default orange stays. Injection stays the
  append-`<style>`-before-`</body>` mechanism.
- Backgrounds are always white/paper → logo always resolved with
  `pickThemedLogoUrl(logo, null)` (dark-theme variant), matching followup.
- Full-page brand backgrounds are structurally impossible: no template rule
  ever consumes `--brand-primary`/`--brand-secondary`, and the injector no
  longer writes them.

## Testing & verification

- `microsite.test.ts` updated in lockstep: new token replacements, case-study
  picker (match, no-match, missing industry, short library), plan-phase
  degradation, accent injection (passes/fails contrast), logo variant, removal
  paths, and a regression test asserting no `--brand-primary` background
  injection survives.
- Acceptance: re-render Signaliz (`aacab760`) and ColdIQ (`9592b080`) leads to
  HTML + PDF; visually verify all 9 pages paginate correctly (no overflow, no
  blank pages) and headers are readable.
- PDF pagination is the highest-risk area: DCN-Deck was designed as a
  scroller. Each page's content must fit A4 landscape at the template's type
  scale; verify with the two real leads plus a max-length synthetic lead.

## Out of scope

- Roster-site "Signal system" second template variant (next project).
- The followup template (approved, untouched).
- Any prompt or AI-step changes.
- Live deployment of regenerated decks.
