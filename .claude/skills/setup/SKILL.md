---
name: setup
description: Use when setting up this repo for the first time, configuring .env, adding or changing provider API keys, or diagnosing why a pipeline step is skipping. Walks through the interactive setup wizard and verifies the result.
---

# Setting up the microsite pipeline

Get a cloned copy of this repo from zero to a working first run.

## The short path

The repo ships an interactive wizard that asks the questions and writes `.env`:

```bash
npx tsx scripts/setup.ts
```

It needs a real terminal (it prompts). **Run it in the foreground and let the user answer the prompts themselves** — never pipe input into it, and never fill in keys on their behalf. If you are running in a context where you cannot hand the terminal over, tell the user to run the command themselves and stop there.

## Before the wizard

Confirm the prerequisites, since the wizard assumes them:

```bash
node --version   # must be >= 20; below that, better-sqlite3 fails to build
npm ci
npx playwright install chromium chromium-headless-shell
```

The Chromium install is a large download and only matters for the PDF step. The wizard checks for it at the end and prints the command if it's missing.

## What the wizard asks

1. **LLM provider** — `api` (an `ANTHROPIC_API_KEY`) or `claude_cli` (a local `claude` binary on a subscription).
2. **Research backend** — `claude` (default, reuses the key above), `parallel`, or `perplexity`.
3. **Optional provider keys** — Deepline, Apify, Firecrawl, Brandfetch. All skippable. When a Deepline or Apify key is given, it also asks the **traffic/ads route** (`ADS_TRAFFIC_PROVIDER`): `auto` (default — Apify first, Deepline-native DataForSEO/Adyntel fallback), `apify` only, or `deepline` only. A Deepline key alone covers traffic + all three ad channels.
4. Writes `.env` (chmod 600), creates `./output` and the local database.

Keys are verified against the real API as they're entered, so a typo or a revoked key surfaces immediately.

## After the wizard

Always confirm with the doctor rather than assuming setup worked:

```bash
npx tsx scripts/doctor.ts
```

It prints a RUN/SKIP table per step and exits non-zero if a required variable is missing. `RESULT: OK.` means a lead can produce a deck.

Then a first run:

```bash
npx tsx scripts/run.ts --lead-url "<linkedin-url>" --name "<name>" --company "<domain>"
npx tsx scripts/serve.ts
```

## Interpreting the doctor output

- **Lots of `SKIP`** — expected. Those providers' keys are absent; the deck renders at lower fidelity. Not an error.
- **Traffic/ads rows** show the live route: "Apify", "Apify, Deepline fallback", or "Deepline (DataForSEO/Adyntel)" per `ADS_TRAFFIC_PROVIDER`.
- **`RESULT: FAIL. Missing required var(s): ...`** — the named variable must be set for the chosen switches. Re-run the wizard or edit `.env`.
- **`Render: the core AI steps ... can't all run`** — no deck will be produced. Almost always a missing or invalid `ANTHROPIC_API_KEY`.

## Populating the proof library (before follow-up decks)

`content/proof-library.yaml` holds the user's case studies, and its metrics
render verbatim on follow-up pages. Before the user sends a follow-up deck:

1. **Ask the user for sources** — case-study PDFs (upload or drop into the
   repo) or the case-study pages on their website. Never populate the library
   from your own knowledge or the seeded examples.
2. **Extract entries from those sources only.** Copy every metric verbatim —
   never round, rephrase, or invent a number.
3. **When a metric can't be read reliably** (e.g. it renders as an animated
   counter or an image), write a `# VERIFY:` comment naming what's missing
   instead of guessing, then ask the user for the real value.
4. A case study needs at least one metric — the schema rejects an empty
   `metrics:` list. Confirm with `npx tsx scripts/followup.ts list` /
   `preview` that drafts pick up the new entries.

## Rules

- **Never print, echo, or paste a key value.** Report `SET` / `EMPTY`, which is what `doctor.ts` does. This applies to reading `.env` too — don't cat it.
- **Never write real keys into `.env.example`.** It holds empty placeholders only.
- `.env` is gitignored; keep it that way.
- Re-running the wizard offers to overwrite an existing `.env` and defaults to *no*. To change one value, edit `.env` directly.
- For a non-interactive setup (CI, containers), use `npx tsx scripts/init.ts` instead: it copies the template without prompting.
