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

const PROMPT_TEMPLATE = readFileSync(
  new URL("../../prompts/followup-narrative.txt", import.meta.url),
  "utf-8"
);
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
    throw new Error(
      `followup narrative picked unknown library ids: ${[...badCases, ...badPlays].join(", ")}`
    );
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
    "company",
    "crm",
    "traffic",
    "ads_meta",
    "ads_google",
    "ads_linkedin",
    "research",
    "tam",
    "icp_segments",
    "sales_signals",
  ],
  timeoutMs: 110_000,
  maxRetries: 1,
  run,
};

export default step;
