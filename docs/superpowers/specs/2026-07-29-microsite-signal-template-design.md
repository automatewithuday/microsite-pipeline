# Signal deck template variant — design

**Date:** 2026-07-29
**Status:** Approved by Uday (brainstorm session)
**Depends on:** shipped DCN deck template (`templates/microsite/`, see
`2026-07-29-microsite-deck-redesign-design.md`)

## Goal

A second deck template variant, `microsite-signal`, porting the Signal design
system from roster-site (github.com/udaykang-byte/roster-site —
`app/globals.css` + `PRODUCT.md` + current Next.js components; the legacy
warm-cream file is explicitly rejected as reference). Business purpose: A/B
the two deck styles per lead and measure reply/meeting rates per variant.

## Decisions (settled with Uday)

1. **Variant wiring:** per-lead nullable `template` value wins, then
   `DECK_TEMPLATE` env var, then default `microsite`. Valid values:
   `microsite`, `microsite-signal`. Unknown value = render **step error**
   (fail loud on config typos), recorded via `markStep`, never thrown past
   the row.
2. **Brand accent:** none in this variant. Fixed coral + chartreuse only;
   the lead's branding appears via logo and content. The pure layer still
   injects `:root{--brand-accent:…}` when a lead passes the AA gate; the
   Signal template never references `var(--brand-accent)`, so the injection
   is inert by construction — no conditional logic in `pure/microsite.ts`.
3. **Chartreuse:** exactly one fixed highlight element per page (design-time
   slots, table below). Always a whole element, never a substring of
   interpolated copy — count-neutral safe.
4. **Architecture:** sibling template dir + shared parameterized builder
   (option A; options B "theme injection" and C "independent copy" rejected).

## Architecture

- **`templates/microsite-signal/`** — `index.src.html` + `fonts/` + built
  `index.html`. Same flow as DCN.
- **Contract byte-identical to DCN:** same 9 sections (Cover, Reading, ICP,
  Market, Openings, Stack, Work, Plan, Close), same `[Token]` names, same
  `data-slot` optional blocks. `pure/microsite.ts` is untouched.
- **`scripts/build-deck-template.ts`** gains a template registry
  `{ name, srcPath, outPath, fontDir, fonts[] }`; a CLI arg selects one
  variant or builds all. The `/*__DECK_FONTS__*/` marker mechanism stays.
- **`src/render.ts`** resolves the template path per lead:
  `lead.template ?? DECK_TEMPLATE ?? "microsite"`, validated against the
  registry names.
- **Schema:** nullable `template` column on leads (local state backend);
  seed/inspect surfaces it.

## Visual system

From roster-site `app/globals.css`:

- True white ground `#FFFFFF`, ink `#111111`, hard 2px black borders,
  `border-radius: 0` everywhere.
- Hard offset shadows only: `4px 4px 0 #111` (cards), `7px 7px 0 #111`
  (large), `5px 5px 0 #111` (CTA).
- **Coral `#F26341`** = structural accent: section numbers, lockup ×,
  display-size figures, fills. Small coral-colored text uses accent-ink
  `#C2431F` (AA 5.1:1 on white). Coral soft tint `rgba(242,99,65,0.08)`
  available for surfaces.
- **Chartreuse `#D9FB3F`** = the one highlight per page (ink text on it).
  Coral and chartreuse never sit adjacent.
- Ink-filled bands (roster stats-ticker pattern) allowed as page elements;
  any accent on a dark surface is FIXED coral — never a variable (DCN
  gotcha).
- **Type:** Archivo (display + sans), incl. `font-stretch: 118%` poster
  headlines and the transparent-fill `-webkit-text-stroke` treatment;
  Geist Mono for labels/metadata.
- **Close page** = full coral fill (roster CTA-section precedent) with ink
  text: `#111111` large, `#4A1204` small (both AA on coral).

### Chartreuse slot per page

| Page | Highlight |
|---|---|
| 01 Cover | the hook line under the lockup |
| 02 Reading | point 1's sub-line (the strongest read) |
| 03 ICP | the ICP descriptor phrase |
| 04 Market | the market figure |
| 05 Openings | opening 01's number |
| 06 Stack | the punch line |
| 07 Work | case 1's metric figure |
| 08 Plan | the "Thirty days" label |
| 09 Close | CTA sits in an ink-filled box (white/chartreuse text) so
  chartreuse never touches the coral page fill |

## Fonts & build

Archivo and Geist Mono are in neither repo. Fetch TTFs from Google Fonts,
pin **static instances** — Archivo 400/500/700 + one expanded-width (wdth
118) 700 instance for poster headlines; Geist Mono 400 — subset to woff2
(parameterize the `scripts/subset-deck-fonts.sh` approach), commit woff2 to
`templates/microsite-signal/fonts/`, shared builder base64-inlines them.
Built HTML stays fully self-contained.

## Error handling

- Unknown template value → render step error (see Decisions).
- Missing built template file → existing "run build-deck-template" error
  message, now naming the variant.
- Proof-library failures degrade exactly as in DCN (Work/Plan pages drop);
  deck copy stays count-neutral where degradation can drop rows.

## Testing

- **Unit:** template resolution precedence (column > env > default;
  unknown → step error); builder registry test; **cross-template contract
  test** extracting the `[Token]` + `data-slot` sets from both
  `index.src.html` files and asserting equality (locks the zero-pure-changes
  guarantee); lint that no template CSS comment contains the literal
  `</body>`.
- **Acceptance** (worktree branched from LOCAL main — origin is behind;
  renders need `DOTENV_CONFIG_PATH=.env.testrun`): render Signaliz
  (aacab760), ColdIQ (9592b080), Cyndx (880c2a6f) and the synthetic
  max-length lead on **Signal**; re-render one lead on **DCN** as a
  regression check on the shared builder/render changes. 9 pages each,
  screenshots at 1123×794.

## Known gotchas carried from the DCN session

- Template CSS comments must never contain the literal `</body>` (accent
  injection anchors on `lastIndexOf`).
- `npx tsx -e` inline imports don't resolve — use script files.
- No `.env` exists; test renders use `.env.testrun` via
  `DOTENV_CONFIG_PATH`.
