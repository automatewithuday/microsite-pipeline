# Signal Deck Template Variant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second deck template variant (`microsite-signal`) porting roster-site's Signal design system, selectable per lead via a `template` field → `DECK_TEMPLATE` env → default.

**Architecture:** Sibling dir `templates/microsite-signal/` whose `index.src.html` keeps a byte-identical `[Token]`/`data-slot` contract with the DCN template, so `src/pure/microsite.ts` is untouched. A new registry module `src/pure/deckTemplates.ts` is the single source of truth for template names and font lists, consumed by a parameterized `scripts/build-deck-template.ts` and by per-lead resolution in `src/render.ts`.

**Tech Stack:** TypeScript (tsx), vitest, Playwright/Chromium PDF, pyftsubset + varLib.instancer via `uvx`, better-sqlite3 local state.

**Spec:** `docs/superpowers/specs/2026-07-29-microsite-signal-template-design.md` — read it before starting any task.

## Global Constraints

- Work in a worktree branched from **LOCAL main** (origin is behind — never base on `origin/main`). Use superpowers:using-git-worktrees.
- No `.env` exists. Any command that imports `src/db.ts` (e.g. `scripts/run.ts`) needs `DOTENV_CONFIG_PATH=.env.testrun`.
- `npx tsx -e` inline scripts with imports DO NOT resolve in this repo — always write a throwaway script file (use `scripts/tmp-*.ts`, delete before committing).
- Template CSS comments must NEVER contain the literal closing-body tag text (accent injection anchors on `lastIndexOf`).
- The Signal template must NEVER reference `var(--brand-accent)` — the pure layer's injection must stay inert by construction.
- Signal palette is FIXED: ink `#111111`, paper `#FFFFFF`, coral `#F26341`, coral-ink `#C2431F` (small coral text), chartreuse `#D9FB3F`, on-coral-muted `#4A1204`. Radius 0 everywhere. Coral and chartreuse never sit adjacent.
- Exactly ONE chartreuse highlight per page (spec table). Highlights are whole elements or spans of STATIC template copy — never a substring of an interpolated token value.
- Python tooling via `uv`/`uvx` only. Paths contain spaces — always quote in shell.
- Run tests with `npx vitest run <file>`; full suite `npx vitest run`.
- Commit after every task; message style follows repo history (imperative, no prefix), ending with the Claude co-author trailer.

---

### Task 1: Deck template registry (`src/pure/deckTemplates.ts`)

**Files:**
- Create: `src/pure/deckTemplates.ts`
- Test: `src/pure/deckTemplates.test.ts`

**Interfaces:**
- Consumes: `LeadRow` type from `src/db.ts` (type-only import, same pattern as `src/pure/microsite.ts:16`).
- Produces (later tasks rely on these exact names):
  - `interface DeckFont { file: string; family: string; weight: number; style: "normal" | "italic" }`
  - `interface DeckTemplateDef { name: string; fonts: DeckFont[] }`
  - `const DECK_TEMPLATES: Record<string, DeckTemplateDef>` with keys `"microsite"` and `"microsite-signal"`
  - `const DEFAULT_DECK_TEMPLATE = "microsite"`
  - `function assertDeckTemplateName(name: string): void` (throws on unknown name)
  - `function resolveDeckTemplate(lead: LeadRow, envValue: string | undefined): string`

- [ ] **Step 1: Write the failing test**

Create `src/pure/deckTemplates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { LeadRow } from "../db.js";
import {
  DECK_TEMPLATES,
  DEFAULT_DECK_TEMPLATE,
  assertDeckTemplateName,
  resolveDeckTemplate,
} from "./deckTemplates.js";

function lead(overrides: Record<string, unknown> = {}): LeadRow {
  return { id: "x", step_status: {}, ...overrides };
}

describe("DECK_TEMPLATES", () => {
  it("contains both variants", () => {
    expect(Object.keys(DECK_TEMPLATES).sort()).toEqual(["microsite", "microsite-signal"]);
  });

  it("keeps the DCN font list unchanged (10 faces)", () => {
    expect(DECK_TEMPLATES["microsite"]!.fonts).toHaveLength(10);
    expect(DECK_TEMPLATES["microsite"]!.fonts[0]).toEqual({
      file: "fraunces-300.woff2", family: "Fraunces", weight: 300, style: "normal",
    });
  });

  it("lists the 5 Signal faces", () => {
    expect(DECK_TEMPLATES["microsite-signal"]!.fonts.map((f) => f.file)).toEqual([
      "archivo-400.woff2", "archivo-500.woff2", "archivo-700.woff2",
      "archivo-expanded-700.woff2", "geistmono-400.woff2",
    ]);
  });
});

describe("assertDeckTemplateName", () => {
  it("accepts known names", () => {
    expect(() => assertDeckTemplateName("microsite")).not.toThrow();
    expect(() => assertDeckTemplateName("microsite-signal")).not.toThrow();
  });
  it("throws on unknown names, listing valid ones", () => {
    expect(() => assertDeckTemplateName("signal")).toThrow(
      'unknown deck template "signal" (valid: microsite, microsite-signal)'
    );
  });
});

describe("resolveDeckTemplate", () => {
  it("defaults to microsite", () => {
    expect(resolveDeckTemplate(lead(), undefined)).toBe("microsite");
  });
  it("uses the env value when the lead has no template", () => {
    expect(resolveDeckTemplate(lead(), "microsite-signal")).toBe("microsite-signal");
  });
  it("lead template wins over env", () => {
    expect(resolveDeckTemplate(lead({ template: "microsite" }), "microsite-signal")).toBe("microsite");
  });
  it("treats empty strings as unset", () => {
    expect(resolveDeckTemplate(lead({ template: "" }), "")).toBe("microsite");
  });
  it("ignores non-string lead.template", () => {
    expect(resolveDeckTemplate(lead({ template: 42 }), undefined)).toBe("microsite");
  });
  it("throws on an unknown lead value", () => {
    expect(() => resolveDeckTemplate(lead({ template: "typo" }), undefined)).toThrow(
      'unknown deck template "typo"'
    );
  });
  it("throws on an unknown env value", () => {
    expect(() => resolveDeckTemplate(lead(), "typo")).toThrow('unknown deck template "typo"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pure/deckTemplates.test.ts`
Expected: FAIL — cannot resolve `./deckTemplates.js`.

- [ ] **Step 3: Write the implementation**

Create `src/pure/deckTemplates.ts`:

```ts
// Registry of deck template variants. Single source of truth for template
// names and the font files each build inlines. Consumed by
// scripts/build-deck-template.ts (build), src/render.ts (per-lead
// resolution), and scripts/seed.ts (CSV validation). Pure: no I/O; the
// caller passes the DECK_TEMPLATE env value in.
import type { LeadRow } from "../db.js";

export interface DeckFont {
  file: string;
  family: string;
  weight: number;
  style: "normal" | "italic";
}

export interface DeckTemplateDef {
  name: string;
  fonts: DeckFont[];
}

export const DECK_TEMPLATES: Record<string, DeckTemplateDef> = {
  microsite: {
    name: "microsite",
    fonts: [
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
    ],
  },
  "microsite-signal": {
    name: "microsite-signal",
    fonts: [
      { file: "archivo-400.woff2", family: "Archivo", weight: 400, style: "normal" },
      { file: "archivo-500.woff2", family: "Archivo", weight: 500, style: "normal" },
      { file: "archivo-700.woff2", family: "Archivo", weight: 700, style: "normal" },
      { file: "archivo-expanded-700.woff2", family: "Archivo Expanded", weight: 700, style: "normal" },
      { file: "geistmono-400.woff2", family: "Geist Mono", weight: 400, style: "normal" },
    ],
  },
};

export const DEFAULT_DECK_TEMPLATE = "microsite";

export function assertDeckTemplateName(name: string): void {
  if (!(name in DECK_TEMPLATES)) {
    throw new Error(
      `unknown deck template "${name}" (valid: ${Object.keys(DECK_TEMPLATES).join(", ")})`
    );
  }
}

/**
 * Per-lead template resolution: the lead's `template` doc field wins, then
 * the DECK_TEMPLATE env value passed by the caller, then the default. Throws
 * on an unknown name so applyRender records a loud step error (a config typo
 * must never silently render the wrong deck).
 */
export function resolveDeckTemplate(lead: LeadRow, envValue: string | undefined): string {
  const fromLead = typeof lead.template === "string" && lead.template.length > 0 ? lead.template : null;
  const fromEnv = envValue && envValue.length > 0 ? envValue : null;
  const name = fromLead ?? fromEnv ?? DEFAULT_DECK_TEMPLATE;
  assertDeckTemplateName(name);
  return name;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pure/deckTemplates.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/pure/deckTemplates.ts src/pure/deckTemplates.test.ts
git commit -m "Add deck template registry with per-lead resolution"
```

---

### Task 2: Parameterize the template builder

**Files:**
- Modify: `scripts/build-deck-template.ts` (full rewrite, 46 lines today)

**Interfaces:**
- Consumes: `DECK_TEMPLATES` from `src/pure/deckTemplates.js` (Task 1).
- Produces: CLI `npx tsx scripts/build-deck-template.ts [variant]` — no arg builds every registry variant; an arg builds one. Later tasks run `npx tsx scripts/build-deck-template.ts microsite-signal`.

- [ ] **Step 1: Rewrite the script**

Replace the whole of `scripts/build-deck-template.ts` with:

```ts
// Combines each variant's templates/<name>/index.src.html with its subset
// woff2 fonts into the self-contained templates/<name>/index.html that
// render.ts reads. Re-run after editing an index.src.html or its fonts:
//   npx tsx scripts/build-deck-template.ts                    # all variants
//   npx tsx scripts/build-deck-template.ts microsite-signal   # one variant
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DECK_TEMPLATES, assertDeckTemplateName } from "../src/pure/deckTemplates.js";

const here = dirname(fileURLToPath(import.meta.url));
const MARKER = "/*__DECK_FONTS__*/";

async function buildOne(name: string): Promise<void> {
  const def = DECK_TEMPLATES[name]!;
  const dir = resolve(here, `../templates/${name}`);
  const srcPath = resolve(dir, "index.src.html");
  const src = await readFile(srcPath, "utf8");
  if (!src.includes(MARKER)) throw new Error(`marker ${MARKER} missing in ${srcPath}`);
  const faces = await Promise.all(
    def.fonts.map(async (f) => {
      const data = await readFile(resolve(dir, "fonts", f.file));
      return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url("data:font/woff2;base64,${data.toString("base64")}") format("woff2");}`;
    })
  );
  const out = src.replace(MARKER, faces.join("\n"));
  await writeFile(resolve(dir, "index.html"), out, "utf8");
  console.log(`wrote ${dir}/index.html (${Math.round(out.length / 1024)} KB)`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg) assertDeckTemplateName(arg);
  const names = arg ? [arg] : Object.keys(DECK_TEMPLATES);
  for (const name of names) await buildOne(name);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the DCN output is byte-identical**

```bash
npx tsx scripts/build-deck-template.ts microsite
git diff --exit-code templates/microsite/index.html
```

Expected: script prints `wrote .../templates/microsite/index.html (... KB)`; `git diff --exit-code` exits 0 (no change). Any diff means the rewrite altered the build — fix before proceeding.

- [ ] **Step 3: Verify the unknown-variant guard**

Run: `npx tsx scripts/build-deck-template.ts typo`
Expected: exits non-zero printing `unknown deck template "typo" (valid: microsite, microsite-signal)`.

Note: the no-arg form will FAIL until Task 4 creates `templates/microsite-signal/index.src.html` — that is expected and correct (loud, not silent).

- [ ] **Step 4: Commit**

```bash
git add scripts/build-deck-template.ts
git commit -m "Parameterize the deck template builder over the registry"
```

---

### Task 3: Signal fonts (fetch, instance, subset, commit)

**Files:**
- Create: `scripts/subset-signal-fonts.sh` (executable)
- Create: `templates/microsite-signal/fonts/archivo-400.woff2`, `archivo-500.woff2`, `archivo-700.woff2`, `archivo-expanded-700.woff2`, `geistmono-400.woff2`

**Interfaces:**
- Consumes: nothing from earlier tasks (network + `uvx` only).
- Produces: the five woff2 files Task 1's registry names, in `templates/microsite-signal/fonts/`.

- [ ] **Step 1: Verify the Google Fonts source URLs exist**

```bash
curl -sfI "https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth%2Cwght%5D.ttf" | head -1
curl -sfI "https://github.com/google/fonts/raw/main/ofl/geistmono/GeistMono%5Bwght%5D.ttf" | head -1
```

Expected: both print an HTTP 200/302 line. If one 404s, find the actual filename by fetching `https://api.github.com/repos/google/fonts/contents/ofl/archivo` (or `.../geistmono`) and update the URL in Step 2 accordingly.

- [ ] **Step 2: Write the subsetting script**

Create `scripts/subset-signal-fonts.sh` (then `chmod +x` it):

```bash
#!/usr/bin/env bash
# One-off: fetch the Archivo + Geist Mono variable TTFs from the google/fonts
# repo, pin static instances, and subset to latin woff2 for the Signal deck
# template. Re-run only if the instances or subset ranges change. Needs uv (uvx).
# Usage: scripts/subset-signal-fonts.sh
set -euo pipefail
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/templates/microsite-signal/fonts"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$OUT_DIR"

# Latin + en/em dash, curly quotes, ellipsis, rightwards arrow (CTA "→").
UNICODES="U+0000-00FF,U+2013-2014,U+2018-2019,U+201C-201D,U+2026,U+2192"

curl -fsSL -o "$TMP_DIR/archivo-var.ttf" \
  "https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth%2Cwght%5D.ttf"
curl -fsSL -o "$TMP_DIR/geistmono-var.ttf" \
  "https://github.com/google/fonts/raw/main/ofl/geistmono/GeistMono%5Bwght%5D.ttf"

# Pin a static instance out of a variable font.
inst() { # inst <src> <axes...> -> writes to the file named by the last arg
  local src="$1"; shift
  local out="${*: -1}"
  local axes=("${@:1:$#-1}")
  uvx --from fonttools fonttools varLib.instancer "$src" "${axes[@]}" -o "$out" >/dev/null
}

inst "$TMP_DIR/archivo-var.ttf" wght=400 wdth=100 "$TMP_DIR/archivo-400.ttf"
inst "$TMP_DIR/archivo-var.ttf" wght=500 wdth=100 "$TMP_DIR/archivo-500.ttf"
inst "$TMP_DIR/archivo-var.ttf" wght=700 wdth=100 "$TMP_DIR/archivo-700.ttf"
# Expanded width axis for poster headlines (roster-site's .display-wide = 118%).
inst "$TMP_DIR/archivo-var.ttf" wght=700 wdth=118 "$TMP_DIR/archivo-expanded-700.ttf"
inst "$TMP_DIR/geistmono-var.ttf" wght=400 "$TMP_DIR/geistmono-400.ttf"

sub() {
  uvx --from "fonttools[woff]" pyftsubset "$TMP_DIR/$1" \
    --output-file="$OUT_DIR/$2" --flavor=woff2 \
    --layout-features='*' --unicodes="$UNICODES"
}
sub "archivo-400.ttf"          "archivo-400.woff2"
sub "archivo-500.ttf"          "archivo-500.woff2"
sub "archivo-700.ttf"          "archivo-700.woff2"
sub "archivo-expanded-700.ttf" "archivo-expanded-700.woff2"
sub "geistmono-400.ttf"        "geistmono-400.woff2"
ls -la "$OUT_DIR"
```

- [ ] **Step 3: Run it and verify the outputs**

```bash
chmod +x scripts/subset-signal-fonts.sh
scripts/subset-signal-fonts.sh
for f in templates/microsite-signal/fonts/*.woff2; do
  printf '%s %s bytes magic=%s\n' "$f" "$(wc -c < "$f")" "$(head -c 4 "$f")"
done
```

Expected: five files, each magic `wOF2`, each roughly 8–40 KB (a file over ~100 KB means instancing failed and the full variable font was subset — rerun and check the `inst` step's output).

- [ ] **Step 4: Commit**

```bash
git add scripts/subset-signal-fonts.sh templates/microsite-signal/fonts
git commit -m "Add subset Archivo + Geist Mono woff2 for the Signal template"
```

---

### Task 4: The Signal template + contract test

**Files:**
- Create: `templates/microsite-signal/index.src.html`
- Create: `templates/microsite-signal/index.html` (built artifact, committed like the DCN one)
- Test: `src/templateContract.test.ts`

**Interfaces:**
- Consumes: fonts from Task 3, builder from Task 2. Reference design: roster-site `app/globals.css` + `PRODUCT.md` (clone `github.com/udaykang-byte/roster-site` to a temp dir if visual reference is needed).
- Produces: `templates/microsite-signal/index.html` that `render.ts` (Task 5) reads. Contract locked by the test: identical token + data-slot sets vs the DCN `index.src.html`.

- [ ] **Step 1: Write the failing contract test**

Create `src/templateContract.test.ts`:

```ts
// Locks the cross-template contract: both deck templates must expose exactly
// the same [Token] and data-slot sets, so src/pure/microsite.ts can build
// either without conditional logic. Also enforces the Signal template's
// structural invariants (no brand accent, clean closing tag, font marker).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const dcn = read("../templates/microsite/index.src.html");
const signal = read("../templates/microsite-signal/index.src.html");

const tokensOf = (html: string): string[] =>
  [...new Set(html.match(/\[[A-Z][A-Za-z0-9 _]*\]/g) ?? [])].sort();
const slotsOf = (html: string): string[] =>
  [...new Set([...html.matchAll(/data-slot="([^"]+)"/g)].map((m) => m[1]!))].sort();

describe("deck template contract", () => {
  it("both templates expose the same token set", () => {
    expect(tokensOf(signal)).toEqual(tokensOf(dcn));
  });

  it("both templates expose the same data-slot set", () => {
    expect(slotsOf(signal)).toEqual(slotsOf(dcn));
  });

  it("both templates carry the font marker", () => {
    expect(dcn).toContain("/*__DECK_FONTS__*/");
    expect(signal).toContain("/*__DECK_FONTS__*/");
  });

  it("signal template never references the brand accent variable", () => {
    expect(signal).not.toContain("--brand-accent");
  });

  it("signal template contains the closing body tag exactly once", () => {
    // Keeps CSS comments clean so the pure layer's lastIndexOf injection
    // anchor always finds the real tag.
    expect(signal.match(/<\/body>/gi)).toHaveLength(1);
  });

  it("both templates have exactly 9 sections", () => {
    expect(dcn.match(/<section /g)).toHaveLength(9);
    expect(signal.match(/<section /g)).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/templateContract.test.ts`
Expected: FAIL — `ENOENT` reading `templates/microsite-signal/index.src.html`.

- [ ] **Step 3: Write the Signal template**

Create `templates/microsite-signal/index.src.html` with EXACTLY this content (the body markup is the DCN body with Signal classes/highlights applied; every `[Token]` and `data-slot` is preserved verbatim):

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
/* Signal system (from roster-site): true white ground, near-black ink, hard
   2px black borders, radius 0, hard offset shadows. Coral = structural
   accent; chartreuse marks exactly ONE thing per page. Fixed palette by
   design: this variant never uses the per-lead brand accent variable. */
:root {
  --ink: #111111;
  --paper: #FFFFFF;
  --coral: #F26341;
  --coral-ink: #C2431F;      /* small coral-toned text on white, AA 5.1:1 */
  --coral-soft: rgba(242, 99, 65, 0.08);
  --signal: #D9FB3F;
  --muted: #3D3D3D;
  --surface-2: #F5F5F4;
  --on-coral-muted: #4A1204; /* small text on a coral fill, AA */
  --shadow-hard: 4px 4px 0 var(--ink);
  --shadow-hard-lg: 7px 7px 0 var(--ink);
  --font-display: 'Archivo Expanded', 'Archivo', system-ui, sans-serif;
  --font-body: 'Archivo', system-ui, -apple-system, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, 'Courier New', monospace;
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
  justify-content: safe center;
  padding: 6vh 6vw;
}
.wrap { width: 100%; max-width: 1040px; margin: 0 auto; }

/* The one chartreuse highlight per page. */
.mark {
  background: var(--signal);
  color: var(--ink);
  padding: 2px 10px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

.eyebrow, .section-num {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--coral-ink);
  margin-bottom: 18px;
}
h2 {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(28px, 3.4vw, 44px);
  line-height: 1.02;
  letter-spacing: 0;
  text-transform: uppercase;
  margin-bottom: 14px;
  text-wrap: balance;
}
.deck {
  font-size: clamp(14px, 1.5vw, 17px);
  line-height: 1.6;
  color: var(--muted);
  max-width: 640px;
  margin-bottom: 40px;
}

/* ── 01 Cover ── */
.cover .lockup { display: flex; align-items: center; gap: 22px; margin-bottom: 7vh; }
.cover .lockup .me { font-weight: 700; font-size: 19px; letter-spacing: -0.01em; }
.cover .lockup .x { font-family: var(--font-body); font-weight: 700; font-size: 20px; color: var(--coral); }
.cover .lockup img { height: 36px; width: auto; object-fit: contain; }
.cover .eyebrow { color: var(--ink); }
.cover h1 {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(40px, 5.2vw, 66px);
  line-height: 0.98;
  letter-spacing: -0.01em;
  text-transform: uppercase;
  max-width: 24ch;
  margin-bottom: 5vh;
  text-wrap: balance;
}
/* Poster stroke treatment: outline carries the letterform, fill transparent. */
.cover h1 em { font-style: normal; color: transparent; -webkit-text-stroke: 2px var(--ink); }
.cover .prepared { border-top: 2px solid var(--ink); padding-top: 22px; max-width: 460px; }
.cover .prepared .who { font-weight: 500; font-size: 15px; }
.cover .prepared .tag { font-family: var(--font-mono); font-size: 12px; color: var(--muted); margin-top: 4px; }

/* ── 02 Reading: auto-renumbering rows ── */
.read-blocks { counter-reset: reading; }
.read-block {
  counter-increment: reading;
  display: grid;
  grid-template-columns: 56px 200px 1fr;
  gap: 28px;
  padding: 20px 0;
  border-top: 2px solid var(--ink);
  align-items: start;
}
.read-block:last-child { border-bottom: 2px solid var(--ink); }
.read-block .num::before { content: "0" counter(reading); }
.read-block .num {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--coral-ink);
  padding-top: 3px;
  letter-spacing: 0.06em;
}
.read-block .label-col {
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.read-block .label-col .sub {
  display: block;
  font-family: var(--font-mono);
  font-weight: 400;
  color: var(--coral-ink);
  margin-top: 4px;
}
/* Page 2's single highlight: the strongest read's sub-label. Degrades with
   the block: if point1 is dropped, the page simply has no highlight. */
.read-block[data-slot="point1"] .label-col .sub {
  display: inline-block;
  background: var(--signal);
  color: var(--ink);
  padding: 2px 8px;
  margin-top: 6px;
}
.read-block .body { font-size: clamp(14px, 1.6vw, 17px); line-height: 1.6; color: var(--muted); }

/* ── 03 ICP ── */
.icp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.icp-card { background: var(--paper); border: 2px solid var(--ink); padding: 24px 26px; box-shadow: var(--shadow-hard); }
.icp-card h3 {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(17px, 2vw, 21px);
  line-height: 1.15;
  margin-bottom: 18px;
}
.icp-row { display: grid; grid-template-columns: 86px 1fr; gap: 14px; padding: 9px 0; border-top: 1px solid var(--ink); }
.icp-row .k {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--coral-ink);
  padding-top: 3px;
}
.icp-row .v { font-size: clamp(13px, 1.4vw, 15px); line-height: 1.5; color: var(--muted); }

/* ── 04 Market funnel ── */
.funnel { display: flex; flex-direction: column; gap: 12px; }
.tier { border: 2px solid var(--ink); padding: 16px 26px; display: flex; align-items: baseline; gap: 24px; background: var(--paper); }
.tier .figure { font-family: var(--font-display); font-weight: 700; font-size: clamp(26px, 3.2vw, 42px); line-height: 1; }
.tier .desc { font-size: clamp(13px, 1.5vw, 16px); color: var(--muted); }
.tier-2 { width: 76%; background: var(--surface-2); }
.tier-3 { width: 52%; background: var(--ink); border-color: var(--ink); }
/* Page 4's single highlight: the figure worth pursuing this year. */
.tier-3 .figure { background: var(--signal); color: var(--ink); padding: 2px 12px; }
.tier-3 .desc { color: rgba(255, 255, 255, 0.75); }
.footnote { margin-top: 26px; font-family: var(--font-mono); font-size: 11px; color: var(--muted); }

/* ── 05 Openings ── */
.openings { counter-reset: opening; }
.opening {
  counter-increment: opening;
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 30px;
  padding: 26px 0;
  border-top: 2px solid var(--ink);
  align-items: start;
}
.opening:last-child { border-bottom: 2px solid var(--ink); }
.opening .num::before { content: "0" counter(opening); }
.opening .num { font-family: var(--font-display); font-weight: 700; font-size: clamp(28px, 3vw, 40px); line-height: 1; color: var(--coral); }
/* Page 5's single highlight: the first opening's number. */
.opening:first-child .num { justify-self: start; background: var(--signal); color: var(--ink); padding: 4px 12px; }
.opening .body { font-size: clamp(15px, 1.7vw, 18px); line-height: 1.6; color: var(--muted); }

/* ── 06 Stack ── */
.stack p.pitch { font-size: clamp(15px, 1.7vw, 18px); line-height: 1.65; color: var(--muted); max-width: 58ch; margin-bottom: 36px; }
.stack p.pitch strong { color: var(--ink); font-weight: 700; }
.chips { display: flex; flex-wrap: wrap; gap: 14px; }
.chip {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 2px solid var(--ink);
  padding: 10px 18px;
  box-shadow: var(--shadow-hard);
}

/* ── 07 Work ── */
.cases { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
.case { border: 2px solid var(--ink); padding: 24px 26px; display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-hard-lg); background: var(--paper); }
.case .client {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--coral-ink);
}
.case h3 {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(16px, 1.9vw, 21px);
  line-height: 1.15;
  text-wrap: balance;
}
.case .approach { font-size: clamp(12px, 1.35vw, 14px); line-height: 1.6; color: var(--muted); }
.case .metric { margin-top: auto; border-top: 2px solid var(--ink); padding-top: 12px; }
.case .metric .figure { font-family: var(--font-display); font-weight: 700; font-size: clamp(22px, 2.6vw, 30px); line-height: 1.1; color: var(--coral); margin-bottom: 6px; }
/* Page 7's single highlight: the lead case's metric figure. Survives
   degradation: a 1-case library keeps case1 and drops case2. */
.case[data-slot="case1"] .metric .figure { display: inline-block; background: var(--signal); color: var(--ink); padding: 2px 10px; }
.case .metric .desc { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }

/* ── 08 Thirty days ── */
.days { display: grid; grid-template-columns: repeat(4, 1fr); gap: 22px; }
.day { border-top: 4px solid var(--ink); padding-top: 14px; }
.day .num {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--coral-ink);
  margin-bottom: 10px;
}
.day p { font-size: clamp(12px, 1.35vw, 14px); line-height: 1.6; color: var(--muted); }

/* ── 09 Close: full coral, ink text, CTA on an ink box ── */
.close { background: var(--coral); }
.close .section-num { color: var(--ink); }
.close .pull {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(30px, 4.2vw, 52px);
  line-height: 1.02;
  text-transform: uppercase;
  max-width: 22ch;
  margin-bottom: 28px;
  text-wrap: balance;
}
.close .pull em { font-style: normal; color: transparent; -webkit-text-stroke: 2px var(--ink); }
.close p.next { font-size: clamp(14px, 1.6vw, 17px); line-height: 1.65; color: var(--on-coral-muted); max-width: 56ch; margin-bottom: 34px; }
/* Page 9's single highlight: chartreuse CTA text on an INK box, so the
   chartreuse never sits directly on the coral page fill. */
.btn-primary {
  display: inline-block;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.02em;
  padding: 16px 30px;
  background: var(--ink);
  color: var(--signal);
  box-shadow: 5px 5px 0 var(--on-coral-muted);
}
.signature { margin-top: 7vh; padding-top: 22px; border-top: 2px solid var(--ink); display: flex; justify-content: space-between; align-items: flex-end; }
.signature .name { font-family: var(--font-display); font-weight: 700; font-size: 20px; }
.signature .sig-meta { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--on-coral-muted); text-align: right; }

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
      <div class="me">automatewith<span style="color:var(--coral-ink);">uday</span></div>
      <div data-slot="logo" style="display:flex;align-items:center;gap:22px;">
        <div class="x">x</div>
        <img src="[LOGO_URL]" alt="[Company] logo">
      </div>
    </div>
    <div class="eyebrow"><span class="mark">A note for [Company]</span></div>
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
    <p class="deck">What the public data says, and what I'd act on. Each point shaped this note.</p>
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
    <p class="deck">Two segments where <span class="mark">the pain is sharpest</span> and the buyer is reachable.</p>
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
    <p class="pitch">The engine is built in your stack. Your workspace, your seats, your data. Enrichment, scoring, and outbound flow straight into <strong>[CRM]</strong> — <span class="mark">nothing held hostage in my tools.</span></p>
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
    <div class="section-num">08 / Thirty days</div>
    <h2>What the first <span class="mark">thirty days</span> look like.</h2>
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

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `npx vitest run src/templateContract.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Build the Signal template**

```bash
npx tsx scripts/build-deck-template.ts microsite-signal
```

Expected: `wrote .../templates/microsite-signal/index.html (~150–300 KB)`.

- [ ] **Step 6: Layout smoke-check with raw tokens**

Write `scripts/tmp-signal-shot.ts`:

```ts
// Throwaway: screenshot every section of the built Signal template (raw
// [tokens] still visible — this checks layout, borders, and highlights).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const html = readFileSync(
  fileURLToPath(new URL("../templates/microsite-signal/index.html", import.meta.url)),
  "utf8"
);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1123, height: 794 } });
await p.setContent(html, { waitUntil: "networkidle" });
const sections = await p.locator("section").all();
for (let i = 0; i < sections.length; i++) {
  await sections[i]!.screenshot({ path: `/tmp/signal-raw-p${i + 1}.png` });
}
await b.close();
console.log("wrote", sections.length, "screenshots to /tmp/signal-raw-p*.png");
```

Run: `npx tsx scripts/tmp-signal-shot.ts` — then READ all 9 PNGs and verify: Archivo renders (not a system fallback — the uppercase display headings must look wide/bold, mono labels must be Geist Mono), 2px hard borders everywhere, no rounded corners, exactly one chartreuse element per page, page 9 fully coral with an ink CTA box, stroke-outline text on pages 1 and 9. Iterate on `index.src.html` (rebuild + re-shoot) until clean, then `rm scripts/tmp-signal-shot.ts`.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass (contract + existing suites).

- [ ] **Step 8: Commit**

```bash
git add templates/microsite-signal/index.src.html templates/microsite-signal/index.html src/templateContract.test.ts
git commit -m "Add the Signal deck template variant with cross-template contract test"
```

---

### Task 5: Per-lead template resolution in the renderer

**Files:**
- Modify: `src/render.ts` (lines 16–17: `TEMPLATE_PATH` const; lines 56–61: readFile block)
- Test: `src/render.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveDeckTemplate` from `src/pure/deckTemplates.js` (Task 1); built templates (Tasks 2/4).
- Produces: `applyRender` honors `lead.template` → `process.env.DECK_TEMPLATE` → default. `renderPdf` and the rest of `applyRender` unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `src/render.test.ts` (inside the existing `describe("applyRender", ...)`; note the file already imports `vi` and mocks `node:fs/promises` — capture the mock via `import { readFile } from "node:fs/promises"` at the top alongside the existing imports, then `const readFileMock = vi.mocked(readFile)`):

```ts
  it("reads the default template path when nothing selects a variant", async () => {
    delete process.env.DECK_TEMPLATE;
    await applyRender(goodLead(), fakePersistence());
    const paths = readFileMock.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes("templates/microsite/index.html"))).toBe(true);
  });

  it("reads the signal template when the lead's template field says so", async () => {
    delete process.env.DECK_TEMPLATE;
    await applyRender(goodLead({ template: "microsite-signal" }), fakePersistence());
    const paths = readFileMock.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes("templates/microsite-signal/index.html"))).toBe(true);
  });

  it("falls back to the DECK_TEMPLATE env var", async () => {
    process.env.DECK_TEMPLATE = "microsite-signal";
    try {
      await applyRender(goodLead(), fakePersistence());
    } finally {
      delete process.env.DECK_TEMPLATE;
    }
    const paths = readFileMock.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes("templates/microsite-signal/index.html"))).toBe(true);
  });

  it("marks a step error on an unknown template value", async () => {
    const p = fakePersistence();
    await applyRender(goodLead({ template: "typo" }), p);
    expect(p.markStep).toHaveBeenCalledWith("8442b5a1", "render", {
      state: "error",
      error: expect.stringContaining('unknown deck template "typo"'),
    });
    expect(p.writeColumn).not.toHaveBeenCalled();
  });
```

If the existing `beforeEach` resets mocks, ensure `readFileMock` call history is inspected AFTER the `applyRender` call in each test (it is, above). If the fs mock's `readFile` isn't exported in a way `vi.mocked` can see, use `const fs = await import("node:fs/promises")` inside the test and read `vi.mocked(fs.readFile).mock.calls`.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/render.test.ts`
Expected: the two variant-path tests and the unknown-template test FAIL (today every render reads `templates/microsite/index.html` and unknown values are ignored); existing tests still pass.

- [ ] **Step 3: Implement the resolution**

In `src/render.ts`:

Replace (lines 12, 16–17):

```ts
import { renderGate, buildMicrositeHtml } from "./pure/microsite.js";
...
const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(here, "../templates/microsite/index.html");
```

with:

```ts
import { renderGate, buildMicrositeHtml } from "./pure/microsite.js";
import { resolveDeckTemplate } from "./pure/deckTemplates.js";
...
const here = dirname(fileURLToPath(import.meta.url));

// DECK_TEMPLATE is read at call time (not hoisted into db.ts) so tests and
// per-batch runs can vary it without re-importing the module graph.
function templatePath(name: string): string {
  return resolve(here, `../templates/${name}/index.html`);
}
```

Replace the readFile block inside the `try` (lines 57–61):

```ts
    const templateHtml = await readFile(TEMPLATE_PATH, "utf8").catch(() => {
      throw new Error(
        `microsite template missing at ${TEMPLATE_PATH}. Run scripts/build-deck-template.ts to regenerate it.`
      );
    });
```

with:

```ts
    const templateName = resolveDeckTemplate(lead, process.env.DECK_TEMPLATE);
    const tPath = templatePath(templateName);
    const templateHtml = await readFile(tPath, "utf8").catch(() => {
      throw new Error(
        `deck template "${templateName}" missing at ${tPath}. Run scripts/build-deck-template.ts ${templateName} to regenerate it.`
      );
    });
```

(`resolveDeckTemplate` throwing inside the `try` lands in the existing catch → `markStep` error, exactly the spec's unknown-value behavior.)

- [ ] **Step 4: Run the full render suite**

Run: `npx vitest run src/render.test.ts`
Expected: PASS (all existing + 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/render.test.ts
git commit -m "Resolve the deck template per lead (template field, DECK_TEMPLATE env, default)"
```

---

### Task 6: Surface the template field in seed and inspect

**Files:**
- Modify: `scripts/seed.ts` (ParsedLead interface ~line 69, `toLeads()` ~lines 77–116)
- Modify: `src/state/types.ts` (SeedLead interface, lines 11–21)
- Modify: `scripts/inspect.ts` (`leadLabel()` ~lines 20–27)

**Interfaces:**
- Consumes: `assertDeckTemplateName` from `src/pure/deckTemplates.js` (Task 1); `upsertLeads` merge semantics (`src/state/local.ts:94` — spread of seed over existing doc, so an OMITTED key preserves the stored value).
- Produces: optional `template` CSV column on `leads.csv`; `template?: string` on `SeedLead`; inspect list shows `[template]` when set.

- [ ] **Step 1: Extend SeedLead**

In `src/state/types.ts`, add to the `SeedLead` interface after `position`:

```ts
  // Optional deck template variant for this lead (validated against
  // DECK_TEMPLATES at seed time). Omitted — not null — when the CSV has no
  // template column, so re-seeding never wipes an existing assignment.
  template?: string;
```

- [ ] **Step 2: Extend seed.ts**

In `scripts/seed.ts`:

Add the import at the top: `import { assertDeckTemplateName } from "../src/pure/deckTemplates.js";`

Add to `ParsedLead`: `template?: string;`

In `toLeads()`, after `const positionIdx = headers.indexOf("position");` add:

```ts
  const templateIdx = headers.indexOf("template");
```

Replace the `leads.push({...})` call with:

```ts
    const lead: ParsedLead = {
      linkedin_url: linkedinUrl,
      first_name: firstNameIdx >= 0 ? row[firstNameIdx]?.trim() || null : null,
      last_name: lastNameIdx >= 0 ? row[lastNameIdx]?.trim() || null : null,
      company: companyIdx >= 0 ? row[companyIdx]?.trim() || null : null,
      position: positionIdx >= 0 ? row[positionIdx]?.trim() || null : null,
    };
    const template = templateIdx >= 0 ? row[templateIdx]?.trim() : "";
    if (template) {
      assertDeckTemplateName(template); // throws with the valid names on a typo
      lead.template = template;
    }
    leads.push(lead);
```

Update the missing-file console message to mention the new column: `"(url, first_name, last_name, company, position, template)"`.

- [ ] **Step 3: Extend inspect.ts**

In `scripts/inspect.ts`, in `leadLabel()`, change the return to append the template when present:

```ts
  const template = typeof lead.template === "string" && lead.template ? `  [${lead.template}]` : "";
  return `${lead.id}  ${name}  (${done}/${Object.keys(status).length} steps done)${template}`;
```

- [ ] **Step 4: Verify by typecheck + suite**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: both clean. (seed.ts runs `main()` on import, so it gets no unit test — the validation logic itself is `assertDeckTemplateName`, already covered in Task 1. The end-to-end path is exercised in Task 7 Step 3.)

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.ts scripts/inspect.ts src/state/types.ts
git commit -m "Surface the per-lead deck template in seed and inspect"
```

---

### Task 7: Acceptance — Signal renders + DCN regression

**Files:**
- No new committed files. Renders update `output/` and `local.db`; throwaway scripts go in `scripts/tmp-*.ts` and are deleted afterwards.

**Interfaces:**
- Consumes: everything above; leads in `local.db`: Signaliz `aacab760-31ab-45ce-801e-c526caac1fac`, ColdIQ `9592b080-e637-4169-9435-aab8613e68c7`, Cyndx `880c2a6f-d472-4054-a3c1-0614b9b471df`.
- Render is local-only (no external APIs), but `scripts/run.ts` imports `src/db.ts`, so every invocation needs `DOTENV_CONFIG_PATH=.env.testrun`.

- [ ] **Step 1: Build both templates via the no-arg form**

```bash
npx tsx scripts/build-deck-template.ts
git diff --exit-code templates/microsite/index.html
```

Expected: writes both `index.html` files; DCN one unchanged.

- [ ] **Step 2: DCN regression render (before touching lead docs)**

```bash
DOTENV_CONFIG_PATH=.env.testrun npx tsx scripts/run.ts --lead 9592b080-e637-4169-9435-aab8613e68c7 --force --step render
```

Expected: completes without a step error; `output/9592b080-....pdf` regenerated on the DCN template (no `template` field set yet, no env var).

- [ ] **Step 3: Assign the Signal template per lead**

Write `scripts/tmp-signal-assign.ts`:

```ts
// Throwaway: set template=microsite-signal on the three acceptance leads via
// the state backend (exercises the per-lead column path end-to-end).
import { getStateBackend } from "../src/state/index.js";

const IDS = [
  "aacab760-31ab-45ce-801e-c526caac1fac",
  "9592b080-e637-4169-9435-aab8613e68c7",
  "880c2a6f-d472-4054-a3c1-0614b9b471df",
];
const state = getStateBackend();
for (const id of IDS) {
  await state.writeColumn(id, "template", "microsite-signal");
  console.log("assigned microsite-signal to", id);
}
```

Run: `DOTENV_CONFIG_PATH=.env.testrun npx tsx scripts/tmp-signal-assign.ts`
Then verify inspect surfaces it: `DOTENV_CONFIG_PATH=.env.testrun npx tsx scripts/inspect.ts` — each of the three lines must end with `[microsite-signal]`.

- [ ] **Step 4: Render all three leads on Signal (per-lead path, no env var)**

```bash
DOTENV_CONFIG_PATH=.env.testrun npx tsx scripts/run.ts --lead aacab760-31ab-45ce-801e-c526caac1fac --force --step render
DOTENV_CONFIG_PATH=.env.testrun npx tsx scripts/run.ts --lead 9592b080-e637-4169-9435-aab8613e68c7 --force --step render
DOTENV_CONFIG_PATH=.env.testrun npx tsx scripts/run.ts --lead 880c2a6f-d472-4054-a3c1-0614b9b471df --force --step render
```

Expected: all three complete without step errors.

- [ ] **Step 5: Page counts**

Write `scripts/tmp-signal-pages.ts`:

```ts
// Throwaway: count PDF pages for the three acceptance renders.
import { readFileSync } from "node:fs";
for (const id of [
  "aacab760-31ab-45ce-801e-c526caac1fac",
  "9592b080-e637-4169-9435-aab8613e68c7",
  "880c2a6f-d472-4054-a3c1-0614b9b471df",
]) {
  const b = readFileSync(`output/${id}.pdf`);
  const n = (b.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(id, "pages:", n);
}
```

Run: `npx tsx scripts/tmp-signal-pages.ts`
Expected: `pages: 9` for all three. More than 9 = a section overflowed A4 — screenshot per section (Step 7), tighten that section's clamps/paddings in `templates/microsite-signal/index.src.html`, rebuild (`npx tsx scripts/build-deck-template.ts microsite-signal`), re-render.

- [ ] **Step 6: Overflow probe with the synthetic max-length lead**

Write `scripts/tmp-signal-synthetic.ts`:

```ts
// Throwaway: render a max-length synthetic lead against the SIGNAL template
// and count pages (overflow clips, never spills to extra pages).
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { buildMicrositeHtml } from "../src/pure/microsite.js";
import { loadProofLibrary } from "../src/proofLibrary.js";

const L = (n: number): string =>
  "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor. ".repeat(n).trim();
const lead = {
  id: "synthetic", company: "Synthetic Maximum Length Company Name Incorporated",
  qualified: true, step_status: {},
  template: "microsite-signal",
  tam: { tamEstimation: 2000000 },
  icp_segments: { segments: [
    { segmentName: "Mid-market B2B SaaS platforms with distributed revenue teams", companyCharacteristic: L(2), keyPainPoint: L(2), primaryBuyer: L(1), differentiatingNeed: L(2) },
    { segmentName: "Enterprise financial services and payroll infrastructure", companyCharacteristic: L(2), keyPainPoint: L(2), primaryBuyer: L(1), differentiatingNeed: L(2) },
  ] },
  sales_signals: { signals: [L(3), L(3), L(3)] },
  logo: { url: "" },
  brand_colors: { primary: "#F8C8DC", secondary: "#FFF0F5" },
  company_data: { merged: { name: "Synthetic Maximum Length Company Name Incorporated", industry: "SaaS" } },
  derived: { paidSearchPct: L(3), liFollowersInsight: L(3), adSummary: L(3), sdrInsight: L(3),
    crmPlatform: "HubSpot", adjustedTam: "1,800,000", adjustedTam2: "1,200,000" },
};
const html = buildMicrositeHtml(
  lead, readFileSync("templates/microsite-signal/index.html", "utf8"), loadProofLibrary()
);
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(html, { waitUntil: "networkidle" });
const pdf = await p.pdf({ format: "A4", printBackground: true, landscape: true });
const n = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log("synthetic pages:", n);
writeFileSync("/tmp/signal-synthetic.pdf", pdf);
await b.close();
```

Run: `npx tsx scripts/tmp-signal-synthetic.ts`
Expected: `synthetic pages: 9`. (Clipping mid-word at 3× typical length is acceptable; extra pages are not.)

- [ ] **Step 7: Visual review, all three leads**

Write `scripts/tmp-signal-review.ts`:

```ts
// Throwaway: screenshot every section of each acceptance render.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const LEADS: Record<string, string> = {
  "aacab760-31ab-45ce-801e-c526caac1fac": "signaliz",
  "9592b080-e637-4169-9435-aab8613e68c7": "coldiq",
  "880c2a6f-d472-4054-a3c1-0614b9b471df": "cyndx",
};
const b = await chromium.launch();
for (const [id, name] of Object.entries(LEADS)) {
  const html = readFileSync(`output/${id}.html`, "utf8");
  const p = await b.newPage({ viewport: { width: 1123, height: 794 } });
  await p.setContent(html, { waitUntil: "networkidle" });
  const sections = await p.locator("section").all();
  for (let i = 0; i < sections.length; i++) {
    await sections[i]!.screenshot({ path: `/tmp/signal-${name}-p${i + 1}.png` });
  }
  await p.close();
  console.log(name, sections.length, "pages");
}
await b.close();
```

Run: `npx tsx scripts/tmp-signal-review.ts` — then READ all 27 PNGs and verify on every page: exactly one chartreuse highlight; hard 2px borders, radius 0; NO lead-brand color anywhere (Signaliz pink, ColdIQ blue, and Cyndx navy must not appear — that's the inert-injection guarantee across all three accent-gate paths); coral close page with ink CTA box; legible text throughout; logos render on white covers.

- [ ] **Step 8: Clean up throwaway scripts**

```bash
rm scripts/tmp-signal-assign.ts scripts/tmp-signal-pages.ts scripts/tmp-signal-synthetic.ts scripts/tmp-signal-review.ts
npx vitest run
```

Expected: working tree has no `tmp-` scripts; full suite passes.

- [ ] **Step 9: Present to Uday — STOP here**

Present the screenshots and PDFs for sign-off (deck look = human decision). Report honestly: page counts, any clipping observed, anything that deviates from the spec table. Do NOT deploy, push, or merge; local artifacts only. Leave the three leads' `template` fields as assigned (Uday decides whether they stay on Signal for the A/B).

---

## Self-Review Notes

- **Spec coverage:** registry + resolution precedence + unknown-value step error (T1, T5); parameterized builder (T2); fonts fetched/instanced/subset/committed (T3); Signal template with fixed palette, per-page chartreuse table, coral close, inert brand accent + contract test + closing-tag/comment lint (T4); seed/inspect surfacing with seed-time validation (T6); acceptance = 3 leads + synthetic on Signal, 1 DCN regression, 9 pages, 1123×794 screenshots, per-lead column exercised end-to-end (T7). Every spec section maps to a task.
- **Contract-test nuance:** the DCN `index.src.html` legitimately contains the closing-body text twice (an inline CSS comment documents the injection point; injection anchors on `lastIndexOf`). The exactly-once assertion therefore applies to the SIGNAL template only.
- **Chartreuse degradation:** page 2's highlight rides `data-slot="point1"` and disappears if that block is dropped (can't highlight absent content — accepted); page 7's rides `case1`, which survives 1-case degradation because the pure layer drops `case2` first.
- **Type consistency check:** `DeckFont`/`DECK_TEMPLATES`/`assertDeckTemplateName`/`resolveDeckTemplate` names match across T1/T2/T5/T6; `SeedLead.template?: string` (omitted-not-null) matches the `upsertLeads` spread-merge semantics; `templatePath(name)` is private to `render.ts`.
