# Personalized Follow-up Deck Generator — Design

**Date:** 2026-07-29
**Status:** Approved approach (Approach A: extend existing pipeline, fixed template, LLM fills structured slots)

## Goal

Generate a DCN-style personalized pitch page per prospect (reference:
https://dcn-followup.netlify.app/ for structure/tone, https://rareideas-roster-deck.vercel.app/
for proof depth). Roughly 70% about the prospect (diagnosis, business reading,
tailored playbook) and 30% proof (case studies, plays, platforms, 30-day plan),
ending in one Cal.com CTA.

- **Funnel use:** cold outreach asset by default; optional follow-up mode where
  call notes deepen the same page. One engine, no separate variant.
- **Review gate:** skim queue. Nothing gets a live URL without an explicit
  `approve`.
- **Proof content:** curated library owned and hand-edited by Uday; the LLM
  selects and frames entries, never rewrites their numbers.
- **Delivery:** auto-deploy on approval via Netlify CLI to a prospect-named
  subdomain (e.g. `acme-growth-plan.netlify.app`).

## Data flow

```
steps 01–12 (existing, unchanged)
   → step 13: followup_narrative      (one Sonnet call → structured JSON)
   → followup render post-pass         (JSON + proof library → templates/followup/)
   → output/<id>.followup.html + .followup.md    (local draft)
   → scripts/followup.ts               (list / preview / approve / regenerate / notes)
   → approve ⇒ Netlify deploy          (URL + timestamp stored on the lead)
```

## Components

### 1. Proof library — `content/proof-library.yaml`

Single hand-editable YAML file (add the `yaml` package). Seeded once by
extracting content from the two deployed decks; the seed is a **draft Uday
reviews and corrects** before first use — the library is the sole source of
truth for his numbers from then on.

Shape (zod-validated at load, schema in `src/pure/proofLibrary.ts`):

- `profile`: positioning line, location/timezone line, Cal.com URL, open-source
  repo links.
- `caseStudies[]`: `id`, `client`, `verticalTags[]`, `motionTags[]`, `problem`,
  `approach`, `metrics[]` (verbatim strings, rendered untouched by the
  template), optional `link`.
- `plays[]`: `id`, `name`, `whenTags[]`, `steps[]`.
- `platforms[]`: `id`, `name`, `description`, optional `link`, `metrics[]`
  (verbatim strings).
- `plan30day`: ordered phases, each `title` + `deliverables[]`.

Load failure (missing file, schema violation) is a step error for step 13 and
a render-gate failure for the post-pass — never a partially rendered page.

### 2. Step 13 — `src/steps/13_followupNarrative.ts`

New `StepModule` following the `12_salesSignals` pattern exactly:

- `name`/`column`: `followup_narrative`
- `dependsOn`: `company`, `crm`, `traffic`, `ads_meta`, `ads_google`,
  `ads_linkedin`, `research`, `tam`, `icp_segments`, `sales_signals`
- Prompt: `prompts/followup-narrative.txt`, interpolated via
  `interpolatePrompt` with placeholders built by a pure function
  (`src/pure/followupData.ts`) from prior step columns plus, when present, the
  lead's `call_notes` column and the proof library's selectable entries
  (ids + tags + one-line summaries only — not full text, to keep the prompt
  small).
- LLM: `runLlm` at `sonnet` tier with a JSON schema (tool-use shape in
  `src/pure/aiSchemas.ts`), ~110s timeout, `maxRetries: 1`.
- Output (zod `followupNarrativeSchema`):
  - `diagnosis[]`: 2–3 items — `title`, `body`, `groundedIn` (which data
    point/step the claim rests on)
  - `businessReading`: short paragraphs
  - `fit`: where Uday operates for this prospect
  - `playbook[]`: 3–5 tailored steps — `title`, `body`
  - `caseStudyPicks[]`: 2–3 of `{ id, relevance }` — ids must exist in the
    library, else step error (no partial write)
  - `playPicks[]`: 1–2 of `{ id, relevance }`, same validation
- Prompt guardrails: inferences phrased as informed hypotheses; hard claims
  only where step data is solid (traffic, ads, signals); no invented numbers;
  no claims about the prospect's internals beyond the research.
- Optional steering: `regenerate --steer "..."` passes a steering note into
  the prompt for that rerun (stored transiently, not a lead column).

Cost: one Sonnet call per lead (≈$0.02–0.05 API; $0 on the Claude CLI
subscription path — handled automatically by `runLlm`).

### 3. Template — `templates/followup/index.html`

Built once to the DCN design standard: single scrolling page, numbered
sections, metric callouts in large type, short paragraphs, horizontal-rule
section breaks. Sections in order: private-follow-up header → diagnosis →
business reading → fit → playbook → case studies → platforms → 30-day plan →
CTA. Themed per prospect from the existing `brand_colors` and `logo_url`
columns (graceful defaults when those steps skipped). Placeholder scheme
matches `templates/microsite/index.html`.

No PDF for this format (decision: the page is the asset; PDF can be added
later if a prospect asks).

### 4. Render post-pass — `src/followupRender.ts` + `src/pure/followup.ts`

Mirrors `render.ts`/`pure/microsite.ts`:

- `followupRenderGate(lead)`: requires `followup_narrative` done and the proof
  library valid; tolerates skipped brand/logo steps.
- `buildFollowupHtml(lead, library, templateHtml)`: pure interpolation of
  narrative JSON + full library entries for the picked ids. Metrics strings
  from the library are inserted verbatim.
- `buildFollowupSkim(lead, library)`: pure builder for the ~30-line
  `.followup.md` skim file — diagnosis claims with their `groundedIn`
  citations, picks with relevance lines, playbook titles, slug, so approval
  takes seconds.
- Post-pass (wired into `scripts/run.ts` alongside the existing `render`
  post-pass, step name `followup_render`): writes `followup_html` column and
  `output/<id>.followup.html` + `output/<id>.followup.md` artifacts. Errors
  caught to `markStep`, never crash the batch.

### 5. Skim queue + deploy — `scripts/followup.ts`

Subcommands:

- `list` — leads whose `followup_render` is done, grouped by status
  (draft / approved+deployed / deploy-failed).
- `preview <id>` — serve/open the local draft HTML (reuse `scripts/serve.ts`
  mechanics) and print the skim markdown.
- `approve <id>` — deploy via Netlify CLI (`npx netlify`): create site named
  from the slug, `deploy --prod` a temp dir containing the draft as
  `index.html`, then write `followup_deploy` column
  `{ url, site_id, slug, at }` and mark `followup_deploy` done. Requires
  `NETLIFY_AUTH_TOKEN` in `.env` (never printed). `--dry-run` prints the
  planned slug and commands without deploying.
- `regenerate <id> [--steer "..."]` — force-rerun step 13 (+ render post-pass)
  for one lead.
- `notes <id> "<call notes>"` — write the `call_notes` column (follow-up
  mode input), reminding to `regenerate` afterward.

Slug: deterministic pure function `followupSlug(companyName)` →
kebab-case + `-growth-plan`; on Netlify name collision, retry with `-2`,
`-3` suffix. A failed deploy records the error on `followup_deploy` and is
retryable by re-running `approve`.

Redeploys after edits: re-running `approve` on an already-deployed lead
redeploys to the same site (site_id stored), keeping the URL stable.

## Error handling summary

- Step 13 JSON/zod/unknown-id failures → step error, retried on next batch
  pass per existing runner semantics; no partial writes.
- Proof library invalid → step 13 error + render gate failure with a message
  naming the file.
- Render post-pass errors → recorded via markStep, batch continues.
- Deploy failures → recorded on the lead, re-approvable; no lead ever
  half-deployed (URL column written only after successful deploy).

## Testing (vitest, matching repo conventions)

- `proofLibrary.test.ts`: schema accept/reject, verbatim-metrics invariants.
- `followupData.test.ts`: placeholder building from lead columns, call-notes
  inclusion, library digest (ids+tags only).
- `aiSchemas.test.ts` additions: narrative schema, bad-id rejection.
- `followup.test.ts` (pure): HTML builder with full/degraded lead data, skim
  builder, slug function (spaces, punctuation, collisions).
- `followupRender.test.ts`: gate logic, artifact/column writes with a fake
  state backend (mirroring `render.test.ts`).
- Deploy path covered by `--dry-run` assertions; no live Netlify calls in
  tests.

## Out of scope (explicitly)

- PDF output for this format.
- Open/scroll tracking and analytics.
- Auto-send/email integration — the output is a URL Uday uses in his own
  sequences.
- Any Supabase/remote state (public build stays local-only).
