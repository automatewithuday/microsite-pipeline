# Contributing

Thanks for taking a look. Issues and pull requests are welcome.

## Getting set up

```bash
npm ci
npx playwright install chromium chromium-headless-shell
npm run setup               # interactive: asks what you need, writes .env
npm test                    # should pass without any API keys
```

`npm run setup` prompts, so for CI or containers use `npx tsx scripts/init.ts`, which copies `.env.example` without asking anything.

Tests are pure and mocked — they make no network calls, so you can run the full suite before adding a single key.

## Before opening a pull request

```bash
npm run typecheck
npm test
```

Both must pass. CI runs exactly these two commands on Node 20.

## How the code is organized

The important convention: **deterministic logic lives in `src/pure/`** as pure, unit-tested functions with no I/O. LLMs are used only for research, TAM, ICP segments, and sales signals. If you can compute something without a model, put it in `src/pure/` and write a test for it.

- `src/pure/` — pure helpers, no I/O, unit-tested. Every file here has a `.test.ts` beside it.
- `src/steps/` — the numbered pipeline steps; each declares its `dependsOn`.
- `src/providers/` — third-party API clients.
- `src/state/` — the local state backend (SQLite + `./output`).

## Adding a pipeline step

1. Add `src/steps/NN_yourStep.ts` declaring `dependsOn`.
2. Register it in `src/steps/index.ts`.
3. Put any non-trivial parsing or math in `src/pure/`, with tests.
4. If it needs a new provider key, make it **optional**: absent key means the step skips cleanly and the deck still renders. Document the key in `.env.example` and the README's key table.

## Design principles to preserve

These are the point of the project — please don't work around them:

1. **No fabricated data.** A missing source drops the field. Never invent a number, email, color, or logo, and never fall back to a plausible-looking default.
2. **Deterministic beats LLM.** Prefer a tested pure function over a model call.
3. **Idempotent steps.** A `done` step doesn't rerun unless forced.
4. **Graceful degradation.** One key or ten, the output stays honest.

## Secrets

Never commit real keys. Secrets belong in `.env` (gitignored); `.env.example` holds empty placeholders only. See [SECURITY.md](SECURITY.md) for reporting vulnerabilities and key-handling guidance.
