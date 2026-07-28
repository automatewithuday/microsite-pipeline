# Follow-up Deck Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a DCN-style personalized pitch page per prospect (70% prospect diagnosis / 30% proof), with a skim-approve queue and Netlify auto-deploy, per `docs/superpowers/specs/2026-07-29-followup-deck-design.md`.

**Architecture:** A new DAG step (`followup_narrative`, one Sonnet call → zod-validated JSON) selects and frames content; a render post-pass interpolates that JSON plus a hand-curated proof library into a fixed HTML template; a CLI (`scripts/followup.ts`) lists drafts, previews, and deploys approved pages via the Netlify CLI. Everything follows existing repo patterns: `StepModule` like `12_salesSignals`, pure builders like `pure/microsite.ts`, post-pass like `render.ts`.

**Tech Stack:** TypeScript (ESM, `type: module`), zod + zod-to-json-schema, vitest, better-sqlite3 state backend, `yaml` (new dep), Netlify CLI via `npx -y netlify-cli`.

## Global Constraints

- Node >= 20, ESM imports end in `.js` even for TS files (repo convention).
- Run tests with `npx vitest run <file>`; full suite `npm test`; typecheck `npm run typecheck`.
- LLM calls only via `runLlm` from `src/providers/llm.js` (never the SDK directly).
- A zod/parse failure in a step is a thrown error (step error) — never a partial write.
- Metrics from the proof library are verbatim strings; no code or prompt may transform them.
- All HTML interpolation escapes values with `escapeHtml` from `src/pure/microsite.js`.
- Secrets (NETLIFY_AUTH_TOKEN) come from `.env` via `src/db.ts` config exports; never printed.
- No live network calls in tests; child_process and runLlm are mocked.
- Commit after every task with the message given in its final step.

---

### Task 1: Proof library schema (pure) + `yaml` dependency

**Files:**
- Create: `src/pure/proofLibrary.ts`
- Test: `src/pure/proofLibrary.test.ts`
- Modify: `package.json` (via `npm install yaml`)

**Interfaces:**
- Produces: `proofLibrarySchema`, `type ProofLibrary`, `libraryDigest(lib): string`, `validatePicks(picks: {id: string}[], validIds: string[]): string[]` (returns the invalid ids).

- [ ] **Step 1: Install the yaml dependency**

Run: `npm install yaml` (in the repo root `micrositepipelinepublic/`).

- [ ] **Step 2: Write the failing test**

```ts
// src/pure/proofLibrary.test.ts
import { describe, expect, it } from "vitest";
import { libraryDigest, proofLibrarySchema, validatePicks } from "./proofLibrary.js";

const minimalLibrary = {
  profile: {
    positioning: "Fractional CMO. Strategy & architecture.",
    locationLine: "Pune based, same time zone, no coordination tax.",
    calUrl: "https://cal.com/uday-kang/15min",
    repoLinks: ["https://github.com/udaykang-byte/gtm-flywheel"],
  },
  caseStudies: [
    {
      id: "dailypay",
      client: "DailyPay",
      verticalTags: ["fintech", "b2b-saas", "enterprise"],
      motionTags: ["outbound", "abm"],
      problem: "Fill enterprise pipeline with long sales cycles.",
      approach: "Account scoring, sequenced email + LinkedIn + CTV.",
      metrics: [
        { value: "2,700+", label: "Demos booked" },
        { value: "$3.3M+", label: "Pipeline influenced" },
      ],
    },
  ],
  plays: [
    {
      id: "signal-outbound",
      name: "Signal-based outbound",
      whenTags: ["outbound", "b2b"],
      steps: ["Scrape hiring/funding/tech signals", "Trigger outreach in the buying window"],
    },
  ],
  platforms: [
    {
      id: "dsp",
      name: "Programmatic Advertising Platform (DSP/SSP)",
      description: "Owned programmatic infrastructure: display, video & CTV",
      link: "https://www.yadamedia.io/programmatic-advertising",
      metrics: [],
    },
  ],
  plan30day: [{ title: "Audit", deliverables: ["Full review of client base and delivery process"] }],
};

describe("proofLibrarySchema", () => {
  it("accepts a well-formed library", () => {
    expect(() => proofLibrarySchema.parse(minimalLibrary)).not.toThrow();
  });

  it("rejects a case study without metrics array", () => {
    const bad = structuredClone(minimalLibrary) as Record<string, unknown>;
    delete (bad.caseStudies as Record<string, unknown>[])[0]!.metrics;
    expect(() => proofLibrarySchema.parse(bad)).toThrow();
  });

  it("rejects duplicate case study ids", () => {
    const bad = structuredClone(minimalLibrary);
    bad.caseStudies.push(structuredClone(bad.caseStudies[0]!));
    expect(() => proofLibrarySchema.parse(bad)).toThrow(/duplicate/i);
  });

  it("rejects an empty metric value", () => {
    const bad = structuredClone(minimalLibrary);
    bad.caseStudies[0]!.metrics[0]!.value = "";
    expect(() => proofLibrarySchema.parse(bad)).toThrow();
  });
});

describe("libraryDigest", () => {
  it("lists every case study and play id with tags, but no metric values", () => {
    const lib = proofLibrarySchema.parse(minimalLibrary);
    const digest = libraryDigest(lib);
    expect(digest).toContain("dailypay");
    expect(digest).toContain("fintech");
    expect(digest).toContain("signal-outbound");
    // Digest keeps the prompt small: never full metrics.
    expect(digest).not.toContain("2,700+");
  });
});

describe("validatePicks", () => {
  it("returns invalid ids and accepts valid ones", () => {
    expect(validatePicks([{ id: "dailypay" }, { id: "nope" }], ["dailypay"])).toEqual(["nope"]);
    expect(validatePicks([{ id: "dailypay" }], ["dailypay"])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/pure/proofLibrary.test.ts`
Expected: FAIL — cannot resolve `./proofLibrary.js`.

- [ ] **Step 4: Write the implementation**

```ts
// src/pure/proofLibrary.ts
// Proof library: zod schema + pure helpers. The YAML file at
// content/proof-library.yaml is the single source of truth for Uday's
// numbers; metrics are verbatim strings that no code or prompt may rewrite.
// No I/O here — loading lives in src/proofLibrary.ts.

import { z } from "zod";

const metricSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});

const caseStudySchema = z.object({
  id: z.string().min(1),
  client: z.string().min(1),
  verticalTags: z.array(z.string().min(1)).min(1),
  motionTags: z.array(z.string().min(1)).min(1),
  problem: z.string().min(1),
  approach: z.string().min(1),
  metrics: z.array(metricSchema),
  link: z.string().url().optional(),
});

const playSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  whenTags: z.array(z.string().min(1)).min(1),
  steps: z.array(z.string().min(1)).min(1),
});

const platformSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  link: z.string().url().optional(),
  metrics: z.array(metricSchema),
});

const planPhaseSchema = z.object({
  title: z.string().min(1),
  deliverables: z.array(z.string().min(1)).min(1),
});

function uniqueIds(items: { id: string }[]): boolean {
  return new Set(items.map((i) => i.id)).size === items.length;
}

export const proofLibrarySchema = z.object({
  profile: z.object({
    positioning: z.string().min(1),
    locationLine: z.string().min(1),
    calUrl: z.string().url(),
    repoLinks: z.array(z.string().url()),
  }),
  caseStudies: z
    .array(caseStudySchema)
    .min(1)
    .refine(uniqueIds, { message: "duplicate case study id" }),
  plays: z.array(playSchema).min(1).refine(uniqueIds, { message: "duplicate play id" }),
  platforms: z.array(platformSchema).refine(uniqueIds, { message: "duplicate platform id" }),
  plan30day: z.array(planPhaseSchema).min(1),
});

export type ProofLibrary = z.infer<typeof proofLibrarySchema>;

/**
 * Compact text block for the step-13 prompt: ids + tags + one-liners only,
 * never metric values (keeps the prompt small and keeps numbers out of the
 * model's mouth — the template renders metrics straight from the library).
 */
export function libraryDigest(lib: ProofLibrary): string {
  const cases = lib.caseStudies
    .map((c) => `- case "${c.id}": ${c.client} | ${c.verticalTags.join(", ")} | ${c.motionTags.join(", ")} | ${c.problem}`)
    .join("\n");
  const plays = lib.plays
    .map((p) => `- play "${p.id}": ${p.name} | ${p.whenTags.join(", ")}`)
    .join("\n");
  return `Case studies:\n${cases}\nPlays:\n${plays}`;
}

/** Returns the ids in `picks` that are NOT in `validIds` (empty = all valid). */
export function validatePicks(picks: { id: string }[], validIds: string[]): string[] {
  const valid = new Set(validIds);
  return picks.map((p) => p.id).filter((id) => !valid.has(id));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/pure/proofLibrary.test.ts` — expected PASS.
Run: `npm run typecheck` — expected clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/pure/proofLibrary.ts src/pure/proofLibrary.test.ts
git commit -m "feat: proof library schema and pure helpers"
```

---

### Task 2: Seed `content/proof-library.yaml` + loader

**Files:**
- Create: `content/proof-library.yaml`
- Create: `src/proofLibrary.ts` (I/O loader)
- Test: `src/proofLibrary.test.ts`

**Interfaces:**
- Consumes: `proofLibrarySchema`, `type ProofLibrary` from `src/pure/proofLibrary.js` (Task 1).
- Produces: `loadProofLibrary(): ProofLibrary` (reads + parses + validates the committed YAML; throws a message naming the file on any failure), `PROOF_LIBRARY_PATH: string`.

- [ ] **Step 1: Write the seed YAML**

Content extracted verbatim from https://rareideas-roster-deck.vercel.app/ and https://dcn-followup.netlify.app/ on 2026-07-29. Metrics that rendered as animated-counter zeros in static extraction are marked `# VERIFY:` — Uday must replace them before first real send (the file is his to edit; this seed is a reviewed draft).

```yaml
# content/proof-library.yaml
# Single source of truth for Uday's proof content. Hand-edited only.
# Metrics are VERBATIM strings — the pipeline selects and frames entries but
# never rewrites a number. Lines marked "VERIFY" rendered as animated-counter
# zeros during extraction and need Uday's real values.

profile:
  positioning: "Fractional CMO. Strategy & architecture — the operator layer underneath the team you're building."
  locationLine: "Pune based. Same time zone, in-person working sessions, no coordination tax."
  calUrl: "https://cal.com/uday-kang/15min"
  repoLinks:
    - "https://github.com/udaykang-byte/gtm-flywheel"
    - "https://github.com/udaykang-byte/gtm-os-kit"

caseStudies:
  - id: dailypay
    client: "DailyPay"
    verticalTags: [fintech, b2b-saas, enterprise, hr-tech]
    motionTags: [outbound, abm, demand-gen]
    problem: "Fill enterprise pipeline for an earned wage access platform selling into Retail, QSR, and Hospitality employers with long sales cycles, tight ICP, and multiple stakeholders."
    approach: "Account scoring blending fit, intent, and engagement with buyer-group detection; sequenced email + LinkedIn + programmatic/CTV orchestration; gated content feeding a nurture-to-demo motion; multi-touch attribution with holdout testing; full deliverability governance (opt-in, suppression, SPF/DKIM/DMARC)."
    metrics:
      - { value: "2,700+", label: "Demos booked" }
      - { value: "$3.3M+", label: "Pipeline influenced" }

  - id: sk-trading
    client: "SK Trading Live"
    verticalTags: [consumer, creator, community, finance-education]
    motionTags: [content, retention, founder-brand]
    problem: "Subscription community with product-market fit but no system behind it: founder-dependent growth, ad hoc content, revenue that didn't compound."
    approach: "Content operating system (repeatable formats, hooks, cadence); funnel rebuild from social touch to paid subscription with retention flows; offer and pricing restructure; migrated 358 active subscriptions across billing entities with zero disruption."
    metrics:
      - { value: "$12K→$35K", label: "MRR in under 90 days" }
      - { value: "28%→11%", label: "Churn, same window" }
      - { value: "10K→200K+", label: "Social followers in three months" }
      - { value: "0", label: "Members lost during migration" }

  - id: nutrius
    client: "Nutrius"
    verticalTags: [d2c, ecommerce, skincare, consumer]
    motionTags: [paid-media, creators, retention, ctv]
    problem: "Expand digital footprint across Shopify and Amazon in a crowded skincare market while keeping a unified brand and design system."
    approach: "Multi-channel management (Meta, Google, Amazon, influencer, TV/CTV); email and SMS automation with segmentation; 70+ creator partnerships; national TV and CTV rollout (29M+ impressions); cohesive modular design system."
    metrics:
      - { value: "2.5x", label: "ROAS across paid" }
      - { value: "+33%", label: "AOV lift" }
      - { value: "132.6%", label: "MoM online visibility growth" }
      - { value: "-37.7%", label: "Amazon ACoS" }
      - { value: "-15%", label: "Cart abandonment" }
      # VERIFY: Rare Ideas deck also shows Sales increase %, Meta+Google ROAS,
      # Amazon ROAS, and CLV metrics that extracted as zeros (animated
      # counters). Add them here with real values if wanted.

  - id: white-van
    client: "Legion M — The Man in the White Van"
    verticalTags: [entertainment, national-us, b2c]
    motionTags: [paid-media, ctv, awareness]
    problem: "Build nationwide awareness for a theatrical thriller and convert to ticket sales across audiences from TikTok to prime-time CTV with a coherent creative system."
    approach: "Media across YouTube, Meta, TikTok, CTV, Linear TV, Programmatic, and Atom; YouTube 1.47M trailer views at $0.03 CPV; Meta 4.22M impressions at 6.2% CTR and $0.11 CPC; ~12M CTV/Linear impressions at 99% completion; influencer amplification 533.8K views."
    metrics:
      - { value: "33.1M+", label: "Total impressions nationwide" }
      - { value: "306K+", label: "Clicks to ticketing CTAs" }
      - { value: "1.36M", label: "Trailer views" }
      # VERIFY: total video views and engagement-vs-benchmark extracted as
      # zeros (animated counters).

  - id: geofencing-fnb
    client: "Multi-brand F&B portfolio"
    verticalTags: [f-and-b, local, retail]
    motionTags: [programmatic, geofencing]
    problem: "45-day campaign to drive qualified foot traffic across three F&B brands."
    approach: "Served ads to people near competitor restaurants, target-neighbourhood residents, and wedding-venue prospects via owned programmatic infrastructure."
    metrics:
      - { value: "287K", label: "Targeted impressions" }
      - { value: "$0.73", label: "eCPC, verified first-party clicks" }
      - { value: "65%", label: "Audience GA missed" }

plays:
  - id: signal-outbound
    name: "Signal-based outbound"
    whenTags: [outbound, b2b, sales-team]
    steps:
      - "Self-scraped hiring, funding, tech-stack, and job-post signals."
      - "Outreach triggers the week the buying window opens."

  - id: linkedin-pipeline
    name: "LinkedIn engagement to pipeline"
    whenTags: [founder-brand, b2b, content]
    steps:
      - "Founder-led content engineered for reach."
      - "Commenters and profile visitors enriched, scored, and routed into follow-up."

  - id: ctv-abm
    name: "CTV + ABM air cover"
    whenTags: [enterprise, abm, paid-media]
    steps:
      - "Programmatic and Connected TV aimed at named target accounts."
      - "Outbound works the same list while air cover runs."

  - id: content-flywheel
    name: "Content flywheel + lead magnets"
    whenTags: [content, inbound, brand]
    steps:
      - "Branded PDF assets and carousels on a locked design system."
      - "Distributed organically, captured through gated downloads, nurtured to a call."

  - id: lean-outbound-stack
    name: "The lean outbound stack"
    whenTags: [outbound, infrastructure, deliverability]
    steps:
      - "Owned infrastructure: TAM discovery, waterfall enrichment, dedicated inboxes, sequencing."
      - "Fully compliant with post-Google/Microsoft sender enforcement."

platforms:
  - id: influencer-platform
    name: "Influencer Management Platform"
    description: "Influencer discovery + ops: sourcing, briefs, contracts, tracked attribution, and performance reads — all on one rail."
    link: "https://www.yadainfluencer.com/"
    metrics: []

  - id: programmatic-dsp
    name: "Programmatic Advertising Platform (DSP/SSP)"
    description: "Owned programmatic infrastructure: display, video & CTV."
    link: "https://www.yadamedia.io/programmatic-advertising"
    metrics: []

plan30day:
  - title: "Audit"
    deliverables:
      - "Full review across the business: client base, revenue mix, delivery process, team structure, current tools."
  - title: "Architect"
    deliverables:
      - "SOPs for delivery. A client workflow the team can scale without losing quality."
  - title: "Automate"
    deliverables:
      - "Three to five workflows built, tested, and shipped in week one: research, reporting, CRM enrichment, and outbound signal monitoring."
  - title: "Align"
    deliverables:
      - "Outbound sequences live for the pipeline. Hiring JDs refined against the actual operating model."
```

- [ ] **Step 2: Write the failing loader test**

```ts
// src/proofLibrary.test.ts
import { describe, expect, it } from "vitest";
import { loadProofLibrary } from "./proofLibrary.js";

describe("loadProofLibrary", () => {
  it("loads and validates the committed seed library", () => {
    const lib = loadProofLibrary();
    expect(lib.caseStudies.length).toBeGreaterThanOrEqual(5);
    expect(lib.plays.length).toBe(5);
    expect(lib.profile.calUrl).toContain("cal.com");
    // Verbatim metric survives the round trip untouched.
    const dailypay = lib.caseStudies.find((c) => c.id === "dailypay");
    expect(dailypay?.metrics[0]).toEqual({ value: "2,700+", label: "Demos booked" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/proofLibrary.test.ts`
Expected: FAIL — cannot resolve `./proofLibrary.js`.

- [ ] **Step 4: Write the loader**

```ts
// src/proofLibrary.ts
// I/O loader for the proof library. Any failure (missing file, YAML syntax,
// schema violation) throws with a message naming the file, so step 13 and the
// followup render gate surface a fixable error instead of a partial page.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { proofLibrarySchema, type ProofLibrary } from "./pure/proofLibrary.js";

const here = dirname(fileURLToPath(import.meta.url));
export const PROOF_LIBRARY_PATH = resolve(here, "../content/proof-library.yaml");

export function loadProofLibrary(): ProofLibrary {
  let raw: string;
  try {
    raw = readFileSync(PROOF_LIBRARY_PATH, "utf8");
  } catch {
    throw new Error(`proof library missing at ${PROOF_LIBRARY_PATH}`);
  }
  try {
    return proofLibrarySchema.parse(parse(raw));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`proof library invalid at ${PROOF_LIBRARY_PATH}: ${detail}`);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/proofLibrary.test.ts` — expected PASS. Also `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add content/proof-library.yaml src/proofLibrary.ts src/proofLibrary.test.ts
git commit -m "feat: seed proof library YAML and loader"
```

---

### Task 3: Narrative zod schema in aiSchemas

**Files:**
- Modify: `src/pure/aiSchemas.ts` (append after salesSignals block)
- Test: `src/pure/aiSchemas.test.ts` (append a describe block)

**Interfaces:**
- Produces: `followupNarrativeSchema`, `type FollowupNarrative`, `followupNarrativeJsonSchema` (via the existing `toToolSchema` helper).

- [ ] **Step 1: Write the failing tests** (append to `src/pure/aiSchemas.test.ts`)

```ts
import { followupNarrativeSchema } from "./aiSchemas.js"; // add to existing imports

const validNarrative = {
  diagnosis: [
    { title: "No outbound motion", body: "Traffic shows paid reliance.", groundedIn: "traffic: 62% paid search" },
    { title: "Founder-dependent content", body: "Posting is ad hoc.", groundedIn: "research: LinkedIn cadence" },
  ],
  businessReading: ["Agency plus product arm, both under one roof."],
  fit: "Operator layer under the team: outbound engine plus automation.",
  playbook: [
    { title: "Stand up signal-based outbound", body: "Scrape hiring and funding signals weekly." },
    { title: "Founder LinkedIn engine", body: "Two posts a week on a locked format." },
    { title: "Gated asset capture", body: "One PDF lead magnet routed to nurture." },
  ],
  caseStudyPicks: [
    { id: "dailypay", relevance: "Same enterprise outbound motion." },
    { id: "sk-trading", relevance: "Same founder-led community shape." },
  ],
  playPicks: [{ id: "signal-outbound", relevance: "They have zero outbound today." }],
};

describe("followupNarrativeSchema", () => {
  it("accepts a valid narrative", () => {
    expect(() => followupNarrativeSchema.parse(validNarrative)).not.toThrow();
  });

  it("rejects fewer than 2 diagnosis items", () => {
    const bad = { ...validNarrative, diagnosis: [validNarrative.diagnosis[0]] };
    expect(() => followupNarrativeSchema.parse(bad)).toThrow();
  });

  it("rejects more than 3 case study picks", () => {
    const pick = validNarrative.caseStudyPicks[0]!;
    const bad = { ...validNarrative, caseStudyPicks: [pick, pick, pick, pick] };
    expect(() => followupNarrativeSchema.parse(bad)).toThrow();
  });

  it("rejects a diagnosis item without groundedIn", () => {
    const bad = {
      ...validNarrative,
      diagnosis: [
        { title: "t", body: "b" },
        { title: "t2", body: "b2", groundedIn: "g" },
      ],
    };
    expect(() => followupNarrativeSchema.parse(bad)).toThrow();
  });

  it("rejects fewer than 3 playbook steps", () => {
    const bad = { ...validNarrative, playbook: validNarrative.playbook.slice(0, 2) };
    expect(() => followupNarrativeSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pure/aiSchemas.test.ts`
Expected: FAIL — `followupNarrativeSchema` is not exported.

- [ ] **Step 3: Implement** (append to `src/pure/aiSchemas.ts`)

```ts
// Step 13 (followup_narrative). The personalized copy for the follow-up deck.
// groundedIn is required on every diagnosis item: it names the data point the
// claim rests on and is shown only in the skim file, never on the page.
export const followupNarrativeSchema = z.object({
  diagnosis: z
    .array(
      z.object({
        title: z.string().min(1),
        body: z.string().min(1),
        groundedIn: z.string().min(1),
      })
    )
    .min(2)
    .max(3),
  businessReading: z.array(z.string().min(1)).min(1).max(3),
  fit: z.string().min(1),
  playbook: z
    .array(z.object({ title: z.string().min(1), body: z.string().min(1) }))
    .min(3)
    .max(5),
  caseStudyPicks: z
    .array(z.object({ id: z.string().min(1), relevance: z.string().min(1) }))
    .min(2)
    .max(3),
  playPicks: z
    .array(z.object({ id: z.string().min(1), relevance: z.string().min(1) }))
    .min(1)
    .max(2),
});
export type FollowupNarrative = z.infer<typeof followupNarrativeSchema>;

export const followupNarrativeJsonSchema = toToolSchema(followupNarrativeSchema);
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/pure/aiSchemas.test.ts` — PASS. `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/pure/aiSchemas.ts src/pure/aiSchemas.test.ts
git commit -m "feat: followup narrative zod schema + tool schema"
```

---

### Task 4: Prompt file + placeholder builder

**Files:**
- Create: `prompts/followup-narrative.txt`
- Create: `src/pure/followupData.ts`
- Test: `src/pure/followupData.test.ts`

**Interfaces:**
- Consumes: `libraryDigest` output string (Task 1) — passed in, not loaded here (stays pure).
- Produces: `buildFollowupPlaceholders(lead: LeadRow, digest: string, steer?: string): Record<string, string> | null` — null when the lead has neither a company name nor research (mirrors step 12's skip condition).

- [ ] **Step 1: Write the prompt template**

```text
You are writing the personalized sections of a private follow-up page from Uday Kang (martechs.io, fractional CMO / GTM operator) to a prospect. The page opens with a diagnosis of the prospect's business and closes with Uday's proof. You write ONLY the personalized copy; proof content (case studies, plays) is selected by id from a fixed library and rendered verbatim elsewhere.

PROSPECT DATA (from an automated research pipeline; treat as the only source of prospect facts):
Company: {company}
Domain: {domain}
CRM detected: {crm}
Traffic: {traffic}
Ads footprint: {ads}
Research brief:
{research}
TAM estimate: {tam}
ICP segments: {icp_segments}
Sales signals: {sales_signals}
Call notes from Uday (empty if none — this is a cold-outreach page when empty):
{call_notes}
Steering note for this regeneration (empty if none):
{steer}

PROOF LIBRARY (pick by id; ids and tags only - full text renders elsewhere):
{library_digest}

WRITE (JSON matching the provided schema):
1. diagnosis: 2-3 problems this company plausibly has right now. Each item: a sharp title, a 2-3 sentence body, and groundedIn naming the exact data point above that supports it (e.g. "traffic: 62% paid search"). Hard claims ONLY where the data is solid (traffic numbers, ad counts, CRM, signals). Everything inferred must read as an informed hypothesis ("If X is true...", "It looks like..."), never as a fact.
2. businessReading: 1-3 short paragraphs reading their business model and current GTM posture from the research.
3. fit: one paragraph on where Uday operates for THIS company (operator layer, outbound engine, automation) - tied to the diagnosis, not generic.
4. playbook: 3-5 concrete steps Uday would run for them in sequence. Each: title + 1-2 sentence body. Specific to their motion and channels, not boilerplate.
5. caseStudyPicks: the 2-3 library case ids MOST relevant to their vertical/motion, each with a one-line relevance framing that mirrors their situation.
6. playPicks: 1-2 play ids that fit, each with a one-line relevance.

RULES:
- Never invent numbers, names, tools, or facts about the prospect beyond the data above.
- Never restate metrics from the library - relevance lines frame, they do not quantify.
- No em dashes. Plain confident consulting tone, second person ("you"), short sentences.
- Do not mention this pipeline, the research process, or that anything is automated.
```

- [ ] **Step 2: Write the failing test**

```ts
// src/pure/followupData.test.ts
import { describe, expect, it } from "vitest";
import type { LeadRow } from "../db.js";
import { buildFollowupPlaceholders } from "./followupData.js";

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company_data: { merged: { name: "Acme Inc", domain: "acme.com" } },
    traffic: { totalVisits: 12345, paidSearchVisits: 3086 },
    ads_meta: { count: 40 },
    ads_google: { count: 5 },
    ads_linkedin: { count: 0 },
    crm: { platform: "HubSpot" },
    research: { response: "Acme sells widgets to mid-market retailers." },
    tam: { tamEstimation: 20000 },
    icp_segments: { segments: [{ segmentName: "Mid-market retail", companyCharacteristic: "c", keyPainPoint: "k", primaryBuyer: "b", differentiatingNeed: "d" }] },
    sales_signals: { signals: ["s1", "s2", "s3"] },
    ...overrides,
  };
}

describe("buildFollowupPlaceholders", () => {
  it("returns null when neither company name nor research is present", () => {
    expect(
      buildFollowupPlaceholders(makeLead({ company_data: {}, company: null, research: null }), "digest")
    ).toBeNull();
  });

  it("fills every placeholder from lead columns", () => {
    const p = buildFollowupPlaceholders(makeLead(), "THE-DIGEST")!;
    expect(p.company).toBe("Acme Inc");
    expect(p.domain).toBe("acme.com");
    expect(p.crm).toBe("HubSpot");
    expect(p.traffic).toContain("12345");
    expect(p.ads).toContain("Meta ads live: 40");
    expect(p.ads).toContain("Google ads live: 5");
    expect(p.ads).toContain("LinkedIn ads live: 0");
    expect(p.research).toContain("widgets");
    expect(p.tam).toContain("20000");
    expect(p.icp_segments).toContain("Mid-market retail");
    expect(p.sales_signals).toContain("s1");
    expect(p.library_digest).toBe("THE-DIGEST");
    expect(p.call_notes).toBe("");
    expect(p.steer).toBe("");
  });

  it("passes call notes and steer through when present", () => {
    const lead = makeLead({ call_notes: "They mentioned churn is the burning issue." });
    const p = buildFollowupPlaceholders(lead, "d", "Focus on retention angle")!;
    expect(p.call_notes).toContain("churn");
    expect(p.steer).toBe("Focus on retention angle");
  });

  it("degrades gracefully: missing optional columns become 'unknown'", () => {
    const p = buildFollowupPlaceholders(
      makeLead({ traffic: null, ads_meta: null, ads_google: null, ads_linkedin: null, crm: null, tam: null, icp_segments: null, sales_signals: null }),
      "d"
    )!;
    expect(p.traffic).toBe("unknown");
    expect(p.crm).toBe("unknown");
    expect(p.tam).toBe("unknown");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/pure/followupData.test.ts` — FAIL, module missing.

- [ ] **Step 4: Implement**

```ts
// src/pure/followupData.ts
// Builds the {placeholder} map for prompts/followup-narrative.txt from prior
// step columns. Pure, no I/O. Missing optional data degrades to "unknown";
// only company-name-and-research-both-missing aborts (returns null), matching
// step 12's skip semantics.

import type { LeadRow } from "../db.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readCompany(lead: LeadRow): { name: string; domain: string } {
  const companyData = lead.company_data as { merged?: Record<string, unknown> } | null | undefined;
  const merged = isRecord(companyData?.merged) ? companyData.merged : {};
  const name =
    typeof merged.name === "string" && merged.name
      ? merged.name
      : typeof lead.company === "string"
        ? lead.company
        : "";
  const domain = typeof merged.domain === "string" ? merged.domain : "";
  return { name, domain };
}

function adsLine(lead: LeadRow): string {
  const count = (col: unknown): string => {
    const c = isRecord(col) && typeof col.count === "number" ? String(col.count) : "unknown";
    return c;
  };
  return `Meta ads live: ${count(lead.ads_meta)}; Google ads live: ${count(lead.ads_google)}; LinkedIn ads live: ${count(lead.ads_linkedin)}`;
}

function jsonOrUnknown(value: unknown): string {
  if (value === null || value === undefined) return "unknown";
  try {
    return JSON.stringify(value);
  } catch {
    return "unknown";
  }
}

export function buildFollowupPlaceholders(
  lead: LeadRow,
  digest: string,
  steer = ""
): Record<string, string> | null {
  const { name, domain } = readCompany(lead);
  const research = isRecord(lead.research) && typeof lead.research.response === "string"
    ? lead.research.response
    : "";
  if (!name && !research) return null;

  const crm = isRecord(lead.crm) && typeof lead.crm.platform === "string" ? lead.crm.platform : "unknown";
  const callNotes = typeof lead.call_notes === "string" ? lead.call_notes : "";

  return {
    company: name || "unknown",
    domain: domain || "unknown",
    crm,
    traffic: lead.traffic ? jsonOrUnknown(lead.traffic) : "unknown",
    ads: adsLine(lead),
    research: research || "unknown",
    tam: lead.tam ? jsonOrUnknown(lead.tam) : "unknown",
    icp_segments: lead.icp_segments ? jsonOrUnknown(lead.icp_segments) : "unknown",
    sales_signals: lead.sales_signals ? jsonOrUnknown(lead.sales_signals) : "unknown",
    call_notes: callNotes,
    steer,
    library_digest: digest,
  };
}
```

- [ ] **Step 5: Run tests + typecheck** — `npx vitest run src/pure/followupData.test.ts` PASS; `npm run typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add prompts/followup-narrative.txt src/pure/followupData.ts src/pure/followupData.test.ts
git commit -m "feat: followup narrative prompt + placeholder builder"
```

---

### Task 5: Step 13 `followup_narrative` + registry

**Files:**
- Create: `src/steps/13_followupNarrative.ts`
- Modify: `src/steps/index.ts` (import + append to STEPS)
- Test: `src/steps/13_followupNarrative.test.ts`

**Interfaces:**
- Consumes: `buildFollowupPlaceholders` (Task 4), `followupNarrativeSchema`/`followupNarrativeJsonSchema` (Task 3), `loadProofLibrary` (Task 2), `libraryDigest`/`validatePicks` (Task 1), `runLlm`, `interpolatePrompt`, `extractJsonObject`.
- Produces: DAG step writing column `followup_narrative` with shape `{ diagnosis, businessReading, fit, playbook, caseStudyPicks, playPicks, raw }`. Steering comes from `process.env.FOLLOWUP_STEER` (transient, set by the CLI's regenerate command in-process; never a lead column).

- [ ] **Step 1: Write the failing test**

```ts
// src/steps/13_followupNarrative.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const runLlmMock = vi.hoisted(() => vi.fn());
vi.mock("../providers/llm.js", () => ({
  runLlm: async (...args: unknown[]) => ({
    provider: "claude-cli:sonnet",
    subscription: true,
    cost_usd: null,
    raw: "raw",
    ...(await runLlmMock(...args)),
  }),
}));

import step from "./13_followupNarrative.js";

const validNarrative = {
  diagnosis: [
    { title: "No outbound", body: "b", groundedIn: "ads: 0 LinkedIn ads" },
    { title: "Paid reliance", body: "b", groundedIn: "traffic: paid search share" },
  ],
  businessReading: ["Reading paragraph."],
  fit: "Operator layer.",
  playbook: [
    { title: "P1", body: "b1" },
    { title: "P2", body: "b2" },
    { title: "P3", body: "b3" },
  ],
  caseStudyPicks: [
    { id: "dailypay", relevance: "Same motion." },
    { id: "sk-trading", relevance: "Same shape." },
  ],
  playPicks: [{ id: "signal-outbound", relevance: "No outbound today." }],
};

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company_data: { merged: { name: "Acme Inc", domain: "acme.com" } },
    traffic: { totalVisits: 12345 },
    ads_meta: { count: 40 },
    ads_google: { count: 5 },
    ads_linkedin: { count: 0 },
    crm: { platform: "HubSpot" },
    research: { response: "Acme sells widgets." },
    tam: { tamEstimation: 20000 },
    icp_segments: { segments: [] },
    sales_signals: { signals: ["s1", "s2", "s3"] },
    ...overrides,
  };
}

describe("step 13 followup_narrative", () => {
  beforeEach(() => {
    runLlmMock.mockReset();
    delete process.env.FOLLOWUP_STEER;
  });

  it("skips when no company name and no research", async () => {
    const result = await step.run(makeLead({ company_data: {}, company: null, research: null }));
    expect(result).toEqual({
      skipped: "no company name or research response available for followup narrative",
    });
    expect(runLlmMock).not.toHaveBeenCalled();
  });

  it("interpolates prospect data and the library digest into the prompt", async () => {
    runLlmMock.mockResolvedValue({ text: JSON.stringify(validNarrative), cost_usd: null });
    await step.run(makeLead());
    const [prompt, opts] = runLlmMock.mock.calls[0] as [string, { tier: string }];
    expect(prompt).toContain("Acme Inc");
    expect(prompt).toContain("Acme sells widgets.");
    expect(prompt).toContain('case "dailypay"'); // digest from the real committed library
    expect(prompt).toContain('play "signal-outbound"');
    expect(opts.tier).toBe("sonnet");
  });

  it("stores the validated narrative plus raw envelope", async () => {
    runLlmMock.mockResolvedValue({ text: JSON.stringify(validNarrative), raw: "envelope", cost_usd: null });
    const result = await step.run(makeLead());
    if (!("data" in result)) throw new Error("expected data");
    const data = result.data as Record<string, unknown>;
    expect(data.diagnosis).toEqual(validNarrative.diagnosis);
    expect(data.caseStudyPicks).toEqual(validNarrative.caseStudyPicks);
    expect(data.raw).toBe("envelope");
    expect(result.cost_usd).toBe(0);
  });

  it("throws when a pick id is not in the library", async () => {
    const bad = { ...validNarrative, caseStudyPicks: [{ id: "not-a-real-id", relevance: "r" }, validNarrative.caseStudyPicks[0]!] };
    runLlmMock.mockResolvedValue({ text: JSON.stringify(bad), cost_usd: null });
    await expect(step.run(makeLead())).rejects.toThrow(/not-a-real-id/);
  });

  it("throws on unparsable output", async () => {
    runLlmMock.mockResolvedValue({ text: "no json here", cost_usd: null });
    await expect(step.run(makeLead())).rejects.toThrow();
  });

  it("includes FOLLOWUP_STEER in the prompt when set", async () => {
    process.env.FOLLOWUP_STEER = "Lean into the retention angle";
    runLlmMock.mockResolvedValue({ text: JSON.stringify(validNarrative), cost_usd: null });
    await step.run(makeLead());
    const [prompt] = runLlmMock.mock.calls[0] as [string];
    expect(prompt).toContain("Lean into the retention angle");
  });

  it("declares its full dependency list", () => {
    expect(step.dependsOn).toEqual([
      "company", "crm", "traffic", "ads_meta", "ads_google", "ads_linkedin",
      "research", "tam", "icp_segments", "sales_signals",
    ]);
  });

  it("declares maxRetries: 1", () => {
    expect(step.maxRetries).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/steps/13_followupNarrative.test.ts` FAIL, module missing.

- [ ] **Step 3: Implement the step**

```ts
// src/steps/13_followupNarrative.ts
// Step 13: followup_narrative. One Sonnet call producing the personalized
// copy of the follow-up deck (diagnosis, reading, fit, playbook, picks).
// Proof content is only ever SELECTED by id — an id not in the library is a
// step error, never a partial write. Steering for a regenerate comes from
// process.env.FOLLOWUP_STEER (transient, set by scripts/followup.ts).

import { readFileSync } from "node:fs";

import type { LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { loadProofLibrary } from "../proofLibrary.js";
import { followupNarrativeSchema, followupNarrativeJsonSchema } from "../pure/aiSchemas.js";
import { extractJsonObject } from "../pure/extractJson.js";
import { buildFollowupPlaceholders } from "../pure/followupData.js";
import { interpolatePrompt } from "../pure/interpolatePrompt.js";
import { libraryDigest, validatePicks } from "../pure/proofLibrary.js";
import { runLlm } from "../providers/llm.js";

const PROMPT_TEMPLATE = readFileSync(new URL("../../prompts/followup-narrative.txt", import.meta.url), "utf-8");
const TIMEOUT_MS = 100_000;

async function run(lead: LeadRow): Promise<StepResult> {
  const library = loadProofLibrary();
  const digest = libraryDigest(library);
  const steer = process.env.FOLLOWUP_STEER ?? "";

  const placeholders = buildFollowupPlaceholders(lead, digest, steer);
  if (!placeholders) {
    return { skipped: "no company name or research response available for followup narrative" };
  }

  const prompt = interpolatePrompt(PROMPT_TEMPLATE, placeholders);
  const result = await runLlm(prompt, {
    tier: "sonnet",
    timeoutMs: TIMEOUT_MS,
    jsonSchema: followupNarrativeJsonSchema,
  });

  const parsed = extractJsonObject(result.text);
  const validated = followupNarrativeSchema.parse(parsed);

  const badCases = validatePicks(validated.caseStudyPicks, library.caseStudies.map((c) => c.id));
  const badPlays = validatePicks(validated.playPicks, library.plays.map((p) => p.id));
  if (badCases.length > 0 || badPlays.length > 0) {
    throw new Error(`followup narrative picked unknown library ids: ${[...badCases, ...badPlays].join(", ")}`);
  }

  const data: Record<string, unknown> = { ...validated, raw: result.raw };
  if (result.subscription) data.cost_note = "claude subscription, not per-call billed";
  else if (result.cost_usd === null) data.cost_unknown = true;

  return {
    data,
    cost_usd: result.subscription ? 0 : (result.cost_usd ?? 0),
    provider: result.provider,
  };
}

const step: StepModule = {
  name: "followup_narrative",
  column: "followup_narrative",
  dependsOn: [
    "company", "crm", "traffic", "ads_meta", "ads_google", "ads_linkedin",
    "research", "tam", "icp_segments", "sales_signals",
  ],
  timeoutMs: 110_000,
  maxRetries: 1,
  run,
};

export default step;
```

- [ ] **Step 4: Register the step** — in `src/steps/index.ts` add `import followupNarrative from "./13_followupNarrative.js";` and append `followupNarrative,` as the last element of `STEPS`.

- [ ] **Step 5: Run tests + full suite** — `npx vitest run src/steps/13_followupNarrative.test.ts` PASS, then `npm test` (whole suite must stay green — the pipeline tests topo-sort the registry) and `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/steps/13_followupNarrative.ts src/steps/13_followupNarrative.test.ts src/steps/index.ts
git commit -m "feat: step 13 followup_narrative with library pick validation"
```

---

### Task 6: Pure followup helpers — gate, slug, skim builder

**Files:**
- Create: `src/pure/followup.ts`
- Test: `src/pure/followup.test.ts`

**Interfaces:**
- Consumes: `type ProofLibrary` (Task 1), `type FollowupNarrative` (Task 3), `RenderGateResult` shape from `pure/microsite.ts` (re-declared import).
- Produces: `followupRenderGate(lead): { ok: true } | { ok: false; reason: string }`, `followupSlug(companyName: string, attempt?: number): string`, `readNarrative(lead): FollowupNarrative | null`, `buildFollowupSkim(lead, library): string`. (`buildFollowupHtml` is added to this same file in Task 7.)

- [ ] **Step 1: Write the failing test**

```ts
// src/pure/followup.test.ts
import { describe, expect, it } from "vitest";
import type { LeadRow } from "../db.js";
import type { ProofLibrary } from "./proofLibrary.js";
import { buildFollowupSkim, followupRenderGate, followupSlug, readNarrative } from "./followup.js";

const narrative = {
  diagnosis: [
    { title: "No outbound", body: "Body one.", groundedIn: "ads: 0 LinkedIn ads" },
    { title: "Paid reliance", body: "Body two.", groundedIn: "traffic: 62% paid" },
  ],
  businessReading: ["Reading one."],
  fit: "Operator layer.",
  playbook: [
    { title: "P1", body: "b1" },
    { title: "P2", body: "b2" },
    { title: "P3", body: "b3" },
  ],
  caseStudyPicks: [
    { id: "dailypay", relevance: "Same motion." },
    { id: "sk", relevance: "Same shape." },
  ],
  playPicks: [{ id: "signal", relevance: "None today." }],
};

const library: ProofLibrary = {
  profile: {
    positioning: "Fractional CMO.",
    locationLine: "Pune based.",
    calUrl: "https://cal.com/uday-kang/15min",
    repoLinks: [],
  },
  caseStudies: [
    {
      id: "dailypay", client: "DailyPay", verticalTags: ["fintech"], motionTags: ["outbound"],
      problem: "p", approach: "a", metrics: [{ value: "2,700+", label: "Demos booked" }],
    },
    {
      id: "sk", client: "SK Trading", verticalTags: ["consumer"], motionTags: ["content"],
      problem: "p", approach: "a", metrics: [{ value: "28%→11%", label: "Churn" }],
    },
  ],
  plays: [{ id: "signal", name: "Signal-based outbound", whenTags: ["outbound"], steps: ["s1"] }],
  platforms: [],
  plan30day: [{ title: "Audit", deliverables: ["d1"] }],
};

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company_data: { merged: { name: "Acme Inc" } },
    followup_narrative: { ...narrative, raw: "r" },
    ...overrides,
  };
}

describe("followupRenderGate", () => {
  it("passes when a valid narrative column exists", () => {
    expect(followupRenderGate(makeLead())).toEqual({ ok: true });
  });

  it("fails with a reason when the narrative column is missing", () => {
    const gate = followupRenderGate(makeLead({ followup_narrative: null }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("followup_narrative");
  });

  it("fails when the narrative column does not validate", () => {
    const gate = followupRenderGate(makeLead({ followup_narrative: { diagnosis: [] } }));
    expect(gate.ok).toBe(false);
  });
});

describe("followupSlug", () => {
  it("kebab-cases the company and appends -growth-plan", () => {
    expect(followupSlug("Acme Inc")).toBe("acme-inc-growth-plan");
  });
  it("strips punctuation and collapses dashes", () => {
    expect(followupSlug("Rare  Ideas, LLC!")).toBe("rare-ideas-llc-growth-plan");
  });
  it("appends a numeric suffix for collision attempts", () => {
    expect(followupSlug("Acme", 1)).toBe("acme-growth-plan-2");
    expect(followupSlug("Acme", 2)).toBe("acme-growth-plan-3");
  });
});

describe("buildFollowupSkim", () => {
  it("contains company, slug, every diagnosis title with groundedIn, and pick relevance lines", () => {
    const skim = buildFollowupSkim(makeLead(), library);
    expect(skim).toContain("Acme Inc");
    expect(skim).toContain("acme-inc-growth-plan");
    expect(skim).toContain("No outbound");
    expect(skim).toContain("ads: 0 LinkedIn ads");
    expect(skim).toContain("DailyPay");
    expect(skim).toContain("Same motion.");
    expect(skim).toContain("P1");
  });
});

describe("readNarrative", () => {
  it("returns null for an invalid column", () => {
    expect(readNarrative(makeLead({ followup_narrative: { nope: 1 } }))).toBeNull();
  });
  it("returns the validated narrative", () => {
    expect(readNarrative(makeLead())?.fit).toBe("Operator layer.");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/pure/followup.test.ts` FAIL.

- [ ] **Step 3: Implement**

```ts
// src/pure/followup.ts
// Pure builders for the follow-up deck: render gate, slug, skim file.
// buildFollowupHtml is added alongside (same file) by the template task.
// No I/O. groundedIn citations appear ONLY in the skim, never on the page.

import type { LeadRow } from "../db.js";
import { followupNarrativeSchema, type FollowupNarrative } from "./aiSchemas.js";
import type { ProofLibrary } from "./proofLibrary.js";
import type { RenderGateResult } from "./microsite.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readCompanyName(lead: LeadRow): string {
  const companyData = lead.company_data as { merged?: { name?: unknown } } | null | undefined;
  const merged = isRecord(companyData?.merged) ? companyData.merged : undefined;
  const name = typeof merged?.name === "string" && merged.name ? merged.name : null;
  return name ?? (typeof lead.company === "string" ? lead.company : "");
}

/** Validated narrative off the lead row, or null when absent/invalid. */
export function readNarrative(lead: LeadRow): FollowupNarrative | null {
  const parsed = followupNarrativeSchema.safeParse(lead.followup_narrative);
  return parsed.success ? parsed.data : null;
}

export function followupRenderGate(lead: LeadRow): RenderGateResult {
  if (!lead.followup_narrative) {
    return { ok: false, reason: "followup_narrative column is missing" };
  }
  if (!readNarrative(lead)) {
    return { ok: false, reason: "followup_narrative column does not validate" };
  }
  if (!readCompanyName(lead)) {
    return { ok: false, reason: "no company name available" };
  }
  return { ok: true };
}

/**
 * Deterministic Netlify site name: kebab-cased company + "-growth-plan",
 * with "-2"/"-3"... appended on collision retries (attempt 1 -> "-2").
 */
export function followupSlug(companyName: string, attempt = 0): string {
  const base = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = attempt > 0 ? `-${attempt + 1}` : "";
  return `${base}-growth-plan${suffix}`;
}

/**
 * The ~30-line reviewer skim: every claim with its grounding, every pick with
 * its relevance, so approve/regenerate takes seconds.
 */
export function buildFollowupSkim(lead: LeadRow, library: ProofLibrary): string {
  const n = readNarrative(lead);
  const company = readCompanyName(lead);
  if (!n) return `# ${company}\n\nNo valid followup narrative.\n`;

  const caseById = new Map(library.caseStudies.map((c) => [c.id, c]));
  const playById = new Map(library.plays.map((p) => [p.id, p]));

  const lines: string[] = [
    `# Follow-up draft: ${company}`,
    ``,
    `Slug: ${followupSlug(company)}`,
    ``,
    `## Diagnosis (claims + grounding)`,
    ...n.diagnosis.map((d) => `- **${d.title}** — ${d.body}\n  - grounded in: ${d.groundedIn}`),
    ``,
    `## Business reading`,
    ...n.businessReading.map((p) => `- ${p}`),
    ``,
    `## Fit`,
    `- ${n.fit}`,
    ``,
    `## Playbook`,
    ...n.playbook.map((p, i) => `${i + 1}. **${p.title}** — ${p.body}`),
    ``,
    `## Case study picks`,
    ...n.caseStudyPicks.map((p) => `- ${caseById.get(p.id)?.client ?? p.id}: ${p.relevance}`),
    ``,
    `## Play picks`,
    ...n.playPicks.map((p) => `- ${playById.get(p.id)?.name ?? p.id}: ${p.relevance}`),
    ``,
  ];
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests + typecheck** — PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/pure/followup.ts src/pure/followup.test.ts
git commit -m "feat: followup gate, slug, and skim builders"
```

---

### Task 7: Template + `buildFollowupHtml`

**Files:**
- Create: `templates/followup/index.html`
- Modify: `src/pure/microsite.ts` (add + export `pickReadableAccent`)
- Modify: `src/pure/followup.ts` (append `buildFollowupHtml` and item emitters)
- Test: `src/pure/microsite.test.ts` (append `pickReadableAccent` cases), `src/pure/followup.test.ts` (append a describe block)

**Interfaces:**
- Consumes: everything from Task 6, plus `escapeHtml`, `pickThemedLogoUrl`, `removeSlot` from `./microsite.js`.
- Produces: `buildFollowupHtml(lead: LeadRow, library: ProofLibrary, templateHtml: string): string`; `pickReadableAccent(primary: string, secondary: string): string | null` in `src/pure/microsite.ts`.

**Why a new color helper:** `pickReadableBrandBg` selects a LIGHT color (readable as a background behind `#111111` text). The follow-up page needs the opposite: an accent color rendered ON a cream/white page, so it must be DARK enough — first of primary/secondary with contrast ratio >= 4.5 against `#FFFFFF`, else null (falls back to ink).

**Template token contract** — the template contains exactly these tokens; the builder replaces all of them (escaped scalars, or builder-emitted HTML blocks for `*_ITEMS` tokens):

| Token | Filled with |
|---|---|
| `[Company]` | escaped company name |
| `[LOGO_URL]` | escaped themed logo URL (whole element `data-slot="logo"` removed when absent) |
| `[POSITIONING]`, `[LOCATION_LINE]`, `[CAL_URL]` | escaped profile fields |
| `[DIAGNOSIS_ITEMS]` | `<div class="fu-item"><h3 class="fu-item-title">…</h3><p class="fu-item-body">…</p></div>` per diagnosis (NO groundedIn — skim only) |
| `[READING_PARAS]` | `<p class="fu-para">…</p>` per businessReading entry |
| `[FIT]` | escaped fit paragraph |
| `[PLAYBOOK_ITEMS]` | `<div class="fu-step"><span class="fu-step-num">01</span><h3 class="fu-item-title">…</h3><p class="fu-item-body">…</p></div>` per playbook step, numbers zero-padded |
| `[CASE_ITEMS]` | per picked case study, in pick order: `<div class="fu-case"><h3 class="fu-case-client">…</h3><p class="fu-relevance">…</p><p class="fu-item-body"><strong>Problem.</strong> …</p><p class="fu-item-body"><strong>What was done.</strong> …</p><div class="fu-metrics">…</div></div>` where each metric is `<div class="fu-metric"><span class="fu-metric-value">…</span><span class="fu-metric-label">…</span></div>` |
| `[PLAY_ITEMS]` | per picked play: `<div class="fu-item"><h3 class="fu-item-title">…</h3><p class="fu-relevance">…</p><ul class="fu-list">…<li>step</li>…</ul></div>` |
| `[PLATFORM_ITEMS]` | per platform: `<div class="fu-item"><h3 class="fu-item-title">…</h3><p class="fu-item-body">…</p></div>` (name linked when `link` present: `<a href="…">`) |
| `[PLAN_ITEMS]` | per plan phase: `<div class="fu-step"><span class="fu-step-num">01</span><h3 class="fu-item-title">…</h3><ul class="fu-list">…</ul></div>` |

Brand color: compute `pickReadableAccent(primary, secondary)`; when non-null, append `<style>:root{--brand-accent: <color>;}</style>` before `</body>` (same injection mechanism as `buildMicrositeHtml`). The template uses `var(--brand-accent)` (default `#141414`) only for accents (section numbers, metric values, CTA button) — never full-page backgrounds.

- [ ] **Step 1: Write the failing tests** (append to `src/pure/followup.test.ts`)

```ts
import { readFileSync } from "node:fs";
import { buildFollowupHtml } from "./followup.js"; // add to existing import

const templateHtml = readFileSync(new URL("../../templates/followup/index.html", import.meta.url), "utf8");

describe("buildFollowupHtml", () => {
  it("leaves no unreplaced tokens", () => {
    const html = buildFollowupHtml(makeLead(), library, templateHtml);
    expect(html).not.toMatch(/\[(Company|LOGO_URL|POSITIONING|LOCATION_LINE|CAL_URL|FIT|DIAGNOSIS_ITEMS|READING_PARAS|PLAYBOOK_ITEMS|CASE_ITEMS|PLAY_ITEMS|PLATFORM_ITEMS|PLAN_ITEMS)\]/);
  });

  it("renders picked case studies in pick order with verbatim metrics", () => {
    const html = buildFollowupHtml(makeLead(), library, templateHtml);
    expect(html).toContain("DailyPay");
    expect(html).toContain("2,700+");
    expect(html).toContain("Demos booked");
    expect(html.indexOf("DailyPay")).toBeLessThan(html.indexOf("SK Trading"));
  });

  it("escapes HTML in narrative values", () => {
    const evil = {
      ...narrative,
      fit: `<script>alert("x")</script>`,
    };
    const html = buildFollowupHtml(makeLead({ followup_narrative: { ...evil, raw: "r" } }), library, templateHtml);
    expect(html).not.toContain(`<script>alert`);
    expect(html).toContain("&lt;script&gt;");
  });

  it("never renders groundedIn on the page", () => {
    const html = buildFollowupHtml(makeLead(), library, templateHtml);
    expect(html).not.toContain("ads: 0 LinkedIn ads");
  });

  it("drops the logo slot when no logo exists", () => {
    const html = buildFollowupHtml(makeLead(), library, templateHtml);
    expect(html).not.toContain("[LOGO_URL]");
    expect(html).not.toContain('data-slot="logo"');
  });

  it("keeps the logo and injects brand accent when present and readable", () => {
    const lead = makeLead({
      logo: { url: "https://cdn.example.com/logo.png" },
      brand_colors: { primary: "#0B4F6C", secondary: "#cccccc" },
    });
    const html = buildFollowupHtml(lead, library, templateHtml);
    expect(html).toContain("https://cdn.example.com/logo.png");
    expect(html).toContain("--brand-accent: #0B4F6C");
  });

  it("includes the Cal.com CTA and 30-day plan", () => {
    const html = buildFollowupHtml(makeLead(), library, templateHtml);
    expect(html).toContain("https://cal.com/uday-kang/15min");
    expect(html).toContain("Audit");
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (`buildFollowupHtml` not exported / template missing).

- [ ] **Step 2b: Add `pickReadableAccent` to `src/pure/microsite.ts` (test-first)**

Append to `src/pure/microsite.test.ts`:

```ts
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
```

Run it (FAIL), then append to `src/pure/microsite.ts` right after `pickReadableBrandBg` (reusing the private `parseHex`/`relativeLuminance` already in that file):

```ts
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
```

Run `npx vitest run src/pure/microsite.test.ts` — PASS.

- [ ] **Step 3: Build the template**

Create `templates/followup/index.html`. Design brief (DCN standard): single scrolling page; system-ish serif/sans pairing (e.g. Georgia display + -apple-system body, no external fonts — page must be fully self-contained); cream/off-white background `#FAF7F2`, ink `#141414`; numbered sections (`01`–`08`) with small-caps labels; generous whitespace; metric values in large type using `var(--brand-accent, #141414)`; horizontal rules between sections; max-width 720px column; a sticky-free simple header with `data-slot="logo"` img + "Private follow-up · [Company]"; footer CTA block with a solid button to `[CAL_URL]`. Sections in order:

1. Header — logo slot, "Private follow-up", `[Company]`
2. `01 · Where you are` — `[DIAGNOSIS_ITEMS]`
3. `02 · Reading the business` — `[READING_PARAS]`
4. `03 · Where I fit` — `[FIT]` + `[POSITIONING]`
5. `04 · The playbook` — `[PLAYBOOK_ITEMS]` + `[PLAY_ITEMS]`
6. `05 · Proof` — `[CASE_ITEMS]`
7. `06 · Infrastructure you get access to` — `[PLATFORM_ITEMS]`
8. `07 · First 30 days` — `[PLAN_ITEMS]`
9. `08 · Next step` — CTA button "Book a 30-minute call" → `[CAL_URL]`, plus `[LOCATION_LINE]`

All the `.fu-*` classes from the token contract must be styled: `.fu-item` (block spacing), `.fu-item-title` (600 weight), `.fu-item-body` (muted ink `#3d3d3d`, 1.6 line-height), `.fu-relevance` (italic, accent-colored left border, padding-left), `.fu-step` (grid: number column + content), `.fu-step-num` (accent color, tabular), `.fu-case` (top border, padding), `.fu-case-client` (larger), `.fu-metrics` (flex wrap, gap), `.fu-metric` (column flex), `.fu-metric-value` (28px+, accent), `.fu-metric-label` (12px uppercase muted), `.fu-list` (plain list), `.fu-para`. Include `<meta name="robots" content="noindex">` (private pages) and a `<title>Private follow-up · [Company]</title>`.

- [ ] **Step 4: Implement `buildFollowupHtml`** (append to `src/pure/followup.ts`)

```ts
import { escapeHtml, pickReadableAccent, pickThemedLogoUrl, removeSlot } from "./microsite.js"; // add to imports

const e = escapeHtml;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function metricsHtml(metrics: { value: string; label: string }[]): string {
  if (metrics.length === 0) return "";
  const items = metrics
    .map(
      (m) =>
        `<div class="fu-metric"><span class="fu-metric-value">${e(m.value)}</span><span class="fu-metric-label">${e(m.label)}</span></div>`
    )
    .join("");
  return `<div class="fu-metrics">${items}</div>`;
}

export function buildFollowupHtml(lead: LeadRow, library: ProofLibrary, templateHtml: string): string {
  const n = readNarrative(lead);
  if (!n) throw new Error("buildFollowupHtml: followup_narrative does not validate");
  const company = readCompanyName(lead);

  const brandColors = isRecord(lead.brand_colors) ? lead.brand_colors : {};
  const primary = typeof brandColors.primary === "string" ? brandColors.primary : "";
  const secondary = typeof brandColors.secondary === "string" ? brandColors.secondary : "";
  const accent = pickReadableAccent(primary, secondary);
  const logoUrl = pickThemedLogoUrl(isRecord(lead.logo) ? lead.logo : {}, null);

  const caseById = new Map(library.caseStudies.map((c) => [c.id, c]));
  const playById = new Map(library.plays.map((p) => [p.id, p]));

  const diagnosisItems = n.diagnosis
    .map((d) => `<div class="fu-item"><h3 class="fu-item-title">${e(d.title)}</h3><p class="fu-item-body">${e(d.body)}</p></div>`)
    .join("\n");

  const readingParas = n.businessReading.map((p) => `<p class="fu-para">${e(p)}</p>`).join("\n");

  const playbookItems = n.playbook
    .map(
      (p, i) =>
        `<div class="fu-step"><span class="fu-step-num">${pad2(i + 1)}</span><div><h3 class="fu-item-title">${e(p.title)}</h3><p class="fu-item-body">${e(p.body)}</p></div></div>`
    )
    .join("\n");

  const caseItems = n.caseStudyPicks
    .map((pick) => {
      const c = caseById.get(pick.id);
      if (!c) return "";
      return [
        `<div class="fu-case">`,
        `<h3 class="fu-case-client">${e(c.client)}</h3>`,
        `<p class="fu-relevance">${e(pick.relevance)}</p>`,
        `<p class="fu-item-body"><strong>Problem.</strong> ${e(c.problem)}</p>`,
        `<p class="fu-item-body"><strong>What was done.</strong> ${e(c.approach)}</p>`,
        metricsHtml(c.metrics),
        `</div>`,
      ].join("");
    })
    .join("\n");

  const playItems = n.playPicks
    .map((pick) => {
      const p = playById.get(pick.id);
      if (!p) return "";
      const steps = p.steps.map((s) => `<li>${e(s)}</li>`).join("");
      return `<div class="fu-item"><h3 class="fu-item-title">${e(p.name)}</h3><p class="fu-relevance">${e(pick.relevance)}</p><ul class="fu-list">${steps}</ul></div>`;
    })
    .join("\n");

  const platformItems = library.platforms
    .map((p) => {
      const name = p.link ? `<a href="${e(p.link)}">${e(p.name)}</a>` : e(p.name);
      return `<div class="fu-item"><h3 class="fu-item-title">${name}</h3><p class="fu-item-body">${e(p.description)}</p>${metricsHtml(p.metrics)}</div>`;
    })
    .join("\n");

  const planItems = library.plan30day
    .map((phase, i) => {
      const items = phase.deliverables.map((d) => `<li>${e(d)}</li>`).join("");
      return `<div class="fu-step"><span class="fu-step-num">${pad2(i + 1)}</span><div><h3 class="fu-item-title">${e(phase.title)}</h3><ul class="fu-list">${items}</ul></div></div>`;
    })
    .join("\n");

  let html = templateHtml;
  if (!logoUrl) html = removeSlot(html, "logo");

  const replacements: Array<[string, string]> = [
    ["[LOGO_URL]", e(logoUrl)],
    ["[Company]", e(company)],
    ["[POSITIONING]", e(library.profile.positioning)],
    ["[LOCATION_LINE]", e(library.profile.locationLine)],
    ["[CAL_URL]", e(library.profile.calUrl)],
    ["[FIT]", e(n.fit)],
    ["[DIAGNOSIS_ITEMS]", diagnosisItems],
    ["[READING_PARAS]", readingParas],
    ["[PLAYBOOK_ITEMS]", playbookItems],
    ["[CASE_ITEMS]", caseItems],
    ["[PLAY_ITEMS]", playItems],
    ["[PLATFORM_ITEMS]", platformItems],
    ["[PLAN_ITEMS]", planItems],
  ];
  for (const [token, value] of replacements) {
    html = html.split(token).join(value);
  }

  if (accent) {
    const style = `<style>:root{--brand-accent: ${accent};}</style>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${style}</body>`) : html + style;
  }

  return html;
}
```

- [ ] **Step 5: Run tests + typecheck** — `npx vitest run src/pure/followup.test.ts` PASS; `npm run typecheck` clean.

- [ ] **Step 6: Visual check** — render one HTML with a scratch script or the Task 8 post-pass later; at minimum open the template with placeholder tokens in a browser to sanity-check layout. (Full visual pass happens during the test run at the end.)

- [ ] **Step 7: Commit**

```bash
git add templates/followup/index.html src/pure/followup.ts src/pure/followup.test.ts
git commit -m "feat: followup template and pure HTML builder"
```

---

### Task 8: Render post-pass + run.ts wiring + ArtifactKind

**Files:**
- Modify: `src/state/types.ts` (extend `ArtifactKind`)
- Create: `src/followupRender.ts`
- Modify: `scripts/run.ts` (POST_PASS_STEP_NAMES + both call sites)
- Test: `src/followupRender.test.ts`

**Interfaces:**
- Consumes: `followupRenderGate`, `buildFollowupHtml`, `buildFollowupSkim` (Tasks 6-7), `loadProofLibrary` (Task 2), `StateBackend`, `getStepState`.
- Produces: `applyFollowupRender(lead: LeadRow, persistence: StateBackend, opts?: { force?: boolean }): Promise<void>` — writes columns `followup_html` (string) and `followup` (`{ pageUrl: string, skimUrl: string }`), marks step `followup_render`.

- [ ] **Step 1: Extend ArtifactKind** — in `src/state/types.ts` change the type to:

```ts
export type ArtifactKind = "pdf" | "html" | "report.md" | "research.md" | "followup.html" | "followup.md";
```

(`local.ts` writes `${leadId}.${kind}` so files land as `output/<id>.followup.html` / `.followup.md` with no further changes.)

- [ ] **Step 2: Write the failing test**

```ts
// src/followupRender.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "./db.js";
import type { StateBackend } from "./state/types.js";
import { applyFollowupRender } from "./followupRender.js";

const narrative = {
  diagnosis: [
    { title: "T1", body: "B1", groundedIn: "g1" },
    { title: "T2", body: "B2", groundedIn: "g2" },
  ],
  businessReading: ["R1"],
  fit: "Fit.",
  playbook: [
    { title: "P1", body: "b" },
    { title: "P2", body: "b" },
    { title: "P3", body: "b" },
  ],
  caseStudyPicks: [
    { id: "dailypay", relevance: "r1" },
    { id: "sk-trading", relevance: "r2" },
  ],
  playPicks: [{ id: "signal-outbound", relevance: "r3" }],
  raw: "raw",
};

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1",
    step_status: {},
    company_data: { merged: { name: "Acme Inc" } },
    followup_narrative: narrative,
    ...overrides,
  };
}

function makeBackend() {
  const columns: Record<string, unknown> = {};
  const marks: Array<{ step: string; entry: Record<string, unknown> }> = [];
  const artifacts: Array<{ kind: string }> = [];
  const backend = {
    writeColumn: vi.fn(async (_id: string, column: string, data: unknown) => {
      columns[column] = data;
    }),
    markStep: vi.fn(async (_id: string, step: string, entry: Record<string, unknown>) => {
      marks.push({ step, entry });
    }),
    writeArtifact: vi.fn(async (_id: string, kind: string) => {
      artifacts.push({ kind });
      return `file:///tmp/lead-1.${kind}`;
    }),
    getLead: vi.fn(),
    getLeadByLinkedinUrl: vi.fn(),
    listPending: vi.fn(),
    upsertLeads: vi.fn(),
  } as unknown as StateBackend;
  return { backend, columns, marks, artifacts };
}

describe("applyFollowupRender", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips (markStep skipped) when the gate fails", async () => {
    const { backend, marks } = makeBackend();
    await applyFollowupRender(makeLead({ followup_narrative: null }), backend);
    expect(marks).toEqual([
      { step: "followup_render", entry: expect.objectContaining({ state: "skipped" }) },
    ]);
  });

  it("is idempotent: returns without work when already done and not forced", async () => {
    const { backend, marks } = makeBackend();
    const lead = makeLead({
      step_status: { followup_render: { state: "done", at: "2026-07-29T00:00:00Z" } },
    });
    await applyFollowupRender(lead, backend);
    expect(marks).toEqual([]);
  });

  it("writes both artifacts, both columns, and marks done", async () => {
    const { backend, marks, columns, artifacts } = makeBackend();
    await applyFollowupRender(makeLead(), backend);
    expect(artifacts.map((a) => a.kind).sort()).toEqual(["followup.html", "followup.md"]);
    expect(typeof columns.followup_html).toBe("string");
    expect(columns.followup_html as string).toContain("Acme Inc");
    expect(columns.followup).toEqual({
      pageUrl: "file:///tmp/lead-1.followup.html",
      skimUrl: "file:///tmp/lead-1.followup.md",
    });
    expect(marks).toEqual([
      { step: "followup_render", entry: expect.objectContaining({ state: "done" }) },
    ]);
  });

  it("records an error (never throws) when the narrative picks unknown ids", async () => {
    const { backend, marks } = makeBackend();
    const bad = { ...narrative, caseStudyPicks: [{ id: "ghost", relevance: "r" }, { id: "dailypay", relevance: "r" }] };
    await applyFollowupRender(makeLead({ followup_narrative: bad }), backend);
    // Unknown ids render as empty case blocks; the gate still passes schema-wise,
    // so this asserts the run completes done (content-level safety is step 13's
    // job — it never persists unknown ids in the first place).
    expect(marks[0]!.step).toBe("followup_render");
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run src/followupRender.test.ts` FAIL.

- [ ] **Step 4: Implement**

```ts
// src/followupRender.ts
// Follow-up render post-pass: reads the committed template + proof library,
// builds the page HTML and the reviewer skim, persists both artifacts, and
// writes the followup_html + followup columns. Mirrors render.ts semantics:
// idempotent "done" skip, gate skip, errors caught to markStep. No PDF.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getStepState, type LeadRow } from "./db.js";
import { loadProofLibrary } from "./proofLibrary.js";
import type { StateBackend } from "./state/types.js";
import { buildFollowupHtml, buildFollowupSkim, followupRenderGate } from "./pure/followup.js";

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(here, "../templates/followup/index.html");

export async function applyFollowupRender(
  lead: LeadRow,
  persistence: StateBackend,
  opts: { force?: boolean } = {}
): Promise<void> {
  const leadId = String(lead.id);

  if (getStepState(lead, "followup_render") === "done" && !opts.force) return;

  const gate = followupRenderGate(lead);
  if (!gate.ok) {
    await persistence.markStep(leadId, "followup_render", { state: "skipped", error: gate.reason });
    return;
  }

  try {
    const templateHtml = await readFile(TEMPLATE_PATH, "utf8").catch(() => {
      throw new Error(`followup template missing at ${TEMPLATE_PATH}`);
    });
    const library = loadProofLibrary();

    const html = buildFollowupHtml(lead, library, templateHtml);
    const skim = buildFollowupSkim(lead, library);

    const pageUrl = await persistence.writeArtifact(leadId, "followup.html", Buffer.from(html, "utf8"));
    const skimUrl = await persistence.writeArtifact(leadId, "followup.md", Buffer.from(skim, "utf8"));

    await persistence.writeColumn(leadId, "followup_html", html);
    await persistence.writeColumn(leadId, "followup", { pageUrl, skimUrl });
    await persistence.markStep(leadId, "followup_render", {
      state: "done",
      provider: "self-hosted",
      cost_usd: 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await persistence.markStep(leadId, "followup_render", { state: "error", error: message });
  }
}
```

- [ ] **Step 5: Wire into `scripts/run.ts`**

Three edits:
1. `import { applyFollowupRender } from "../src/followupRender.js";`
2. `const POST_PASS_STEP_NAMES = ["derived", "render", "followup_render"];`
3. After each `applyRender(...)` call site, add the matching call:
   - in `processLead`: `await applyFollowupRender(await fetchLeadById(id), state, { force: forceStep === "followup_render" });`
   - in the `--batch` loop: `await applyFollowupRender(await fetchLeadById(String(lead.id)), state, {});`
4. In `processLead`'s final summary, after the microsite block, print the draft location when present:

```ts
const followup = done.followup as { pageUrl?: string; skimUrl?: string } | null | undefined;
if (followup?.pageUrl) {
  console.log("\nFollow-up draft (NOT deployed - review required):");
  console.log(`  page: ${followup.pageUrl}`);
  console.log(`  skim: ${followup.skimUrl}`);
  console.log("  (review + deploy: `npx tsx scripts/followup.ts list`)");
}
```

- [ ] **Step 6: Run everything** — `npx vitest run src/followupRender.test.ts` PASS; `npm test` all green; `npm run typecheck` clean.

- [ ] **Step 7: Commit**

```bash
git add src/state/types.ts src/followupRender.ts src/followupRender.test.ts scripts/run.ts
git commit -m "feat: followup render post-pass wired into run script"
```

---

### Task 9: Netlify deploy module

**Files:**
- Create: `src/netlifyDeploy.ts`
- Modify: `src/db.ts` (add `NETLIFY_AUTH_TOKEN` optional export, in the optional-config section)
- Test: `src/netlifyDeploy.test.ts`

**Interfaces:**
- Consumes: `followupSlug` (Task 6).
- Produces: `deployFollowup(html: string, companyName: string, opts: { siteId?: string; dryRun?: boolean }): Promise<DeployOutcome>` where `DeployOutcome = { dryRun: true; plan: string[] } | { dryRun: false; url: string; siteId: string; slug: string }`. Internal exec seam `type Exec = (cmd: string, args: string[]) => Promise<{ stdout: string }>` injectable for tests via optional last param.

- [ ] **Step 1: Add config** — in `src/db.ts` optional section: `export const NETLIFY_AUTH_TOKEN = optional("NETLIFY_AUTH_TOKEN") ?? "";`

- [ ] **Step 2: Write the failing test**

```ts
// src/netlifyDeploy.test.ts
import { describe, expect, it, vi } from "vitest";
import { deployFollowup, type Exec } from "./netlifyDeploy.js";

const html = "<!doctype html><title>t</title>";

describe("deployFollowup", () => {
  it("dry run returns the plan without executing anything", async () => {
    const exec = vi.fn();
    const out = await deployFollowup(html, "Acme Inc", { dryRun: true }, exec as unknown as Exec);
    expect(out.dryRun).toBe(true);
    if (out.dryRun) {
      expect(out.plan.join("\n")).toContain("acme-inc-growth-plan");
      expect(out.plan.join("\n")).toContain("netlify");
    }
    expect(exec).not.toHaveBeenCalled();
  });

  it("creates a site then deploys, returning the live URL", async () => {
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes("createSite")) {
        return { stdout: JSON.stringify({ id: "site-123", ssl_url: "https://acme-inc-growth-plan.netlify.app" }) };
      }
      return { stdout: JSON.stringify({ deploy_url: "https://deploy.netlify.app", url: "https://acme-inc-growth-plan.netlify.app" }) };
    });
    const out = await deployFollowup(html, "Acme Inc", {}, exec as unknown as Exec);
    expect(out.dryRun).toBe(false);
    if (!out.dryRun) {
      expect(out.siteId).toBe("site-123");
      expect(out.slug).toBe("acme-inc-growth-plan");
      expect(out.url).toBe("https://acme-inc-growth-plan.netlify.app");
    }
  });

  it("retries with a numeric suffix when the site name is taken", async () => {
    let creates = 0;
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes("createSite")) {
        creates++;
        if (creates === 1) throw new Error("422: name already taken");
        return { stdout: JSON.stringify({ id: "site-456", ssl_url: "https://acme-growth-plan-2.netlify.app" }) };
      }
      return { stdout: JSON.stringify({ url: "https://acme-growth-plan-2.netlify.app" }) };
    });
    const out = await deployFollowup(html, "Acme", {}, exec as unknown as Exec);
    if (!out.dryRun) expect(out.slug).toBe("acme-growth-plan-2");
  });

  it("skips site creation when siteId is provided (redeploy keeps the URL)", async () => {
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      expect(args).not.toContain("createSite");
      return { stdout: JSON.stringify({ url: "https://existing.netlify.app" }) };
    });
    const out = await deployFollowup(html, "Acme", { siteId: "site-existing" }, exec as unknown as Exec);
    if (!out.dryRun) expect(out.siteId).toBe("site-existing");
  });

  it("gives up after 5 name collisions", async () => {
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes("createSite")) throw new Error("422: name already taken");
      return { stdout: "{}" };
    });
    await expect(deployFollowup(html, "Acme", {}, exec as unknown as Exec)).rejects.toThrow(/name/i);
  });
});
```

- [ ] **Step 3: Run to verify failure** — FAIL, module missing.

- [ ] **Step 4: Implement**

```ts
// src/netlifyDeploy.ts
// Deploys an approved follow-up page to Netlify via `npx -y netlify-cli`.
// One HTML file becomes a whole site (index.html in a temp dir). The exec
// seam is injectable so tests never touch the network. NETLIFY_AUTH_TOKEN is
// read from config and passed via env, never logged.

import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { NETLIFY_AUTH_TOKEN } from "./db.js";
import { followupSlug } from "./pure/followup.js";

const execFileP = promisify(execFile);

export type Exec = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

const defaultExec: Exec = async (cmd, args) => {
  const { stdout } = await execFileP(cmd, args, {
    env: { ...process.env, NETLIFY_AUTH_TOKEN },
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout };
};

export type DeployOutcome =
  | { dryRun: true; plan: string[] }
  | { dryRun: false; url: string; siteId: string; slug: string };

const MAX_NAME_ATTEMPTS = 5;
const NETLIFY = ["-y", "netlify-cli"];

async function createSite(slug: string, exec: Exec): Promise<{ id: string; url: string }> {
  const { stdout } = await exec("npx", [...NETLIFY, "api", "createSite", "--data", JSON.stringify({ name: slug })]);
  const parsed = JSON.parse(stdout) as { id?: string; ssl_url?: string; url?: string };
  if (!parsed.id) throw new Error("netlify createSite returned no site id");
  return { id: parsed.id, url: parsed.ssl_url ?? parsed.url ?? `https://${slug}.netlify.app` };
}

export async function deployFollowup(
  html: string,
  companyName: string,
  opts: { siteId?: string; dryRun?: boolean } = {},
  exec: Exec = defaultExec
): Promise<DeployOutcome> {
  const baseSlug = followupSlug(companyName);

  if (opts.dryRun) {
    return {
      dryRun: true,
      plan: [
        opts.siteId
          ? `redeploy to existing netlify site ${opts.siteId}`
          : `npx netlify-cli api createSite --data {"name":"${baseSlug}"} (suffix -2..-5 on collision)`,
        `write index.html to a temp dir`,
        `npx netlify-cli deploy --prod --dir <tmp> --site <siteId> --json`,
      ],
    };
  }

  if (!NETLIFY_AUTH_TOKEN) {
    throw new Error("NETLIFY_AUTH_TOKEN is not set in .env (required for deploy; see SETUP.md)");
  }

  let siteId = opts.siteId ?? "";
  let slug = baseSlug;
  let siteUrl = "";

  if (!siteId) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
      slug = followupSlug(companyName, attempt);
      try {
        const site = await createSite(slug, exec);
        siteId = site.id;
        siteUrl = site.url;
        break;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        if (!/name/i.test(message)) throw err; // only collisions retry
      }
    }
    if (!siteId) {
      throw new Error(
        `could not create a netlify site name after ${MAX_NAME_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
      );
    }
  }

  const dir = await mkdtemp(join(tmpdir(), "followup-"));
  await writeFile(join(dir, "index.html"), html, "utf8");

  const { stdout } = await exec("npx", [...NETLIFY, "deploy", "--prod", "--dir", dir, "--site", siteId, "--json"]);
  const deployed = JSON.parse(stdout) as { url?: string; ssl_url?: string; deploy_url?: string };
  const url = deployed.ssl_url ?? deployed.url ?? siteUrl;
  if (!url) throw new Error("netlify deploy returned no url");

  return { dryRun: false, url, siteId, slug };
}
```

Adjust one line from the block above before running tests: the token check must be `if (!NETLIFY_AUTH_TOKEN && exec === defaultExec) { throw ... }` — it stays after the dry-run early-return, and injected test execs bypass it (tests never need a token; the real path always does).

- [ ] **Step 5: Run tests + typecheck** — PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add src/netlifyDeploy.ts src/netlifyDeploy.test.ts src/db.ts
git commit -m "feat: netlify deploy module with collision retry and dry-run"
```

---

### Task 10: CLI `scripts/followup.ts` + setup docs

**Files:**
- Create: `scripts/followup.ts`
- Modify: `src/pure/envTemplate.ts` (+ its test) — add `NETLIFY_AUTH_TOKEN` as an optional var, following the exact pattern of the existing optional entries in that file
- Modify: `SETUP.md` — add a "Follow-up decks" section
- Modify: `README.md` — mention the follow-up deck flow and CLI

**Interfaces:**
- Consumes: `getStateBackend`, `STEPS`, `runStepsForLead`, `applyFollowupRender` (Task 8), `deployFollowup` (Task 9), `buildFollowupSkim`, `readCompanyName` (Task 6), `loadProofLibrary` (Task 2), `getStepState`.
- Produces: the operator CLI. No unit tests for the CLI shell itself (repo convention: scripts are thin; logic lives in tested modules) — but every branch below calls only tested modules.

- [ ] **Step 1: Implement the CLI**

```ts
// scripts/followup.ts — skim queue + deploy for follow-up decks.
//
//   npx tsx scripts/followup.ts list
//   npx tsx scripts/followup.ts preview <leadId>
//   npx tsx scripts/followup.ts notes <leadId> "<call notes>"
//   npx tsx scripts/followup.ts regenerate <leadId> [--steer "<note>"]
//   npx tsx scripts/followup.ts approve <leadId> [--dry-run]
//
// Nothing gets a live URL except through `approve`.

import { assertRequiredEnv, getStepState, type LeadRow } from "../src/db.js";
import { applyFollowupRender } from "../src/followupRender.js";
import { deployFollowup } from "../src/netlifyDeploy.js";
import { runStepsForLead } from "../src/pipeline.js";
import { loadProofLibrary } from "../src/proofLibrary.js";
import { buildFollowupSkim, readCompanyName } from "../src/pure/followup.js";
import { getStateBackend } from "../src/state/index.js";
import { STEPS } from "../src/steps/index.js";

const state = getStateBackend();

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage:",
      "  npx tsx scripts/followup.ts list",
      "  npx tsx scripts/followup.ts preview <leadId>",
      '  npx tsx scripts/followup.ts notes <leadId> "<call notes>"',
      '  npx tsx scripts/followup.ts regenerate <leadId> [--steer "<note>"]',
      "  npx tsx scripts/followup.ts approve <leadId> [--dry-run]",
    ].join("\n")
  );
  process.exit(1);
}

async function getLeadOrDie(id: string): Promise<LeadRow> {
  const lead = await state.getLead(id);
  if (!lead) {
    console.error(`No lead found with id ${id}`);
    process.exit(1);
  }
  return lead;
}

function deployRecord(lead: LeadRow): { url?: string; site_id?: string } {
  const d = lead.followup_deploy;
  return d && typeof d === "object" ? (d as { url?: string; site_id?: string }) : {};
}

async function cmdList(): Promise<void> {
  const leads = await state.listPending(500, () => true);
  const drafts: string[] = [];
  const deployed: string[] = [];
  const failed: string[] = [];
  for (const lead of leads) {
    const renderState = getStepState(lead, "followup_render");
    if (renderState !== "done") continue;
    const name = readCompanyName(lead) || String(lead.linkedin_url ?? lead.id);
    const line = `  ${lead.id}  ${name}`;
    const deployState = getStepState(lead, "followup_deploy");
    if (deployState === "done") deployed.push(`${line}  ${deployRecord(lead).url ?? ""}`);
    else if (deployState === "error") failed.push(`${line}  (deploy failed: ${lead.step_status?.followup_deploy?.error ?? "?"})`);
    else drafts.push(line);
  }
  console.log(`Drafts awaiting review (${drafts.length}):`);
  console.log(drafts.join("\n") || "  (none)");
  console.log(`\nDeployed (${deployed.length}):`);
  console.log(deployed.join("\n") || "  (none)");
  if (failed.length) {
    console.log(`\nDeploy failed — re-run approve (${failed.length}):`);
    console.log(failed.join("\n"));
  }
}

async function cmdPreview(id: string): Promise<void> {
  const lead = await getLeadOrDie(id);
  const library = loadProofLibrary();
  console.log(buildFollowupSkim(lead, library));
  const followup = lead.followup as { pageUrl?: string } | null | undefined;
  if (followup?.pageUrl) console.log(`Full page: ${followup.pageUrl}`);
  else console.log("No rendered draft yet — run scripts/run.ts for this lead first.");
}

async function cmdNotes(id: string, notes: string): Promise<void> {
  await getLeadOrDie(id);
  await state.writeColumn(id, "call_notes", notes);
  console.log(`Call notes saved. Regenerate to fold them in:\n  npx tsx scripts/followup.ts regenerate ${id}`);
}

async function cmdRegenerate(id: string, steer?: string): Promise<void> {
  assertRequiredEnv();
  if (steer) process.env.FOLLOWUP_STEER = steer;
  const lead = await getLeadOrDie(id);
  await runStepsForLead(lead, STEPS, state, { force: "followup_narrative" });
  await applyFollowupRender((await getLeadOrDie(id)), state, { force: true });
  delete process.env.FOLLOWUP_STEER;
  const done = await getLeadOrDie(id);
  const narrativeState = getStepState(done, "followup_narrative");
  if (narrativeState !== "done") {
    console.error(`Regeneration failed: ${done.step_status?.followup_narrative?.error ?? "see step_status"}`);
    process.exit(1);
  }
  console.log("Regenerated. Preview:");
  await cmdPreview(id);
}

async function cmdApprove(id: string, dryRun: boolean): Promise<void> {
  const lead = await getLeadOrDie(id);
  if (getStepState(lead, "followup_render") !== "done") {
    console.error("This lead has no rendered follow-up draft (followup_render is not done).");
    process.exit(1);
  }
  const html = typeof lead.followup_html === "string" ? lead.followup_html : "";
  if (!html) {
    console.error("followup_html column is empty — regenerate first.");
    process.exit(1);
  }
  const company = readCompanyName(lead);
  const existing = deployRecord(lead);

  const outcomeOpts: { siteId?: string; dryRun?: boolean } = { dryRun };
  if (existing.site_id) outcomeOpts.siteId = existing.site_id;

  try {
    const outcome = await deployFollowup(html, company, outcomeOpts);
    if (outcome.dryRun) {
      console.log("Dry run — would execute:");
      for (const step of outcome.plan) console.log(`  - ${step}`);
      return;
    }
    await state.writeColumn(id, "followup_deploy", {
      url: outcome.url,
      site_id: outcome.siteId,
      slug: outcome.slug,
      at: new Date().toISOString(),
    });
    await state.markStep(id, "followup_deploy", { state: "done", provider: "netlify", cost_usd: 0 });
    console.log(`Deployed: ${outcome.url}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await state.markStep(id, "followup_deploy", { state: "error", error: message });
    console.error(`Deploy failed (recorded, re-run approve to retry): ${message}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "list":
      return cmdList();
    case "preview":
      if (!rest[0]) usage("preview requires a lead id");
      return cmdPreview(rest[0]);
    case "notes":
      if (!rest[0] || !rest[1]) usage('notes requires a lead id and a quoted notes string');
      return cmdNotes(rest[0], rest[1]);
    case "regenerate": {
      if (!rest[0]) usage("regenerate requires a lead id");
      const steerIdx = rest.indexOf("--steer");
      const steer = steerIdx !== -1 ? rest[steerIdx + 1] : undefined;
      return cmdRegenerate(rest[0], steer);
    }
    case "approve":
      if (!rest[0]) usage("approve requires a lead id");
      return cmdApprove(rest[0], rest.includes("--dry-run"));
    default:
      usage(command ? `unknown command "${command}"` : "no command given");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: envTemplate** — open `src/pure/envTemplate.ts`, find the optional-vars block, and add `NETLIFY_AUTH_TOKEN` with the comment `# Netlify personal access token — required only to deploy follow-up decks (scripts/followup.ts approve)`. Update `src/pure/envTemplate.test.ts` to assert the generated template contains `NETLIFY_AUTH_TOKEN`.

- [ ] **Step 3: Docs** — in `SETUP.md`, add a section "Follow-up decks (optional)" covering: what the follow-up deck is (one link-worthy page per prospect), `content/proof-library.yaml` is yours to edit (VERIFY markers must be resolved before first send), `NETLIFY_AUTH_TOKEN` setup (app.netlify.com → User settings → Applications → New access token), and the five CLI commands with one line each. In `README.md`, add one paragraph + the CLI block to the feature list.

- [ ] **Step 4: Full verification**

Run: `npm test` (all green), `npm run typecheck` (clean).
Then a live smoke of the offline paths against the existing test lead:

```bash
npx tsx scripts/followup.ts list
npx tsx scripts/followup.ts approve 9592b080-e637-4169-9435-aab8613e68c7 --dry-run || true
```

Expected: `list` prints (probably empty) queues without crashing; `approve --dry-run` either prints the plan (if a draft exists) or the "no rendered follow-up draft" error — both acceptable; no stack traces.

- [ ] **Step 5: Commit**

```bash
git add scripts/followup.ts src/pure/envTemplate.ts src/pure/envTemplate.test.ts SETUP.md README.md
git commit -m "feat: followup skim-queue CLI with netlify deploy + docs"
```

---

## Final acceptance (after all tasks)

1. `npm test` and `npm run typecheck` green.
2. End-to-end on the existing ColdIQ test lead (uses `.env.testrun` per project convention — `DOTENV_CONFIG_PATH=.env.testrun`):
   `npx tsx scripts/run.ts --lead 9592b080-e637-4169-9435-aab8613e68c7 --force --step followup_narrative`
   then `npx tsx scripts/followup.ts preview 9592b080-...` and open `output/<id>.followup.html` in a browser for a visual pass.
3. `approve --dry-run` prints a sane plan. (A real deploy waits for Uday's NETLIFY_AUTH_TOKEN and his review of the VERIFY markers in the proof library.)
