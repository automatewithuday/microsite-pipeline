// Step 11: icp_segments. Runs the Sonnet tier via runLlm (the Anthropic API or
// the Claude CLI, per LLM_PROVIDER).
//
// prompts/icp-segments.txt is a faithful reconstruction of the redacted
// original prompt (not verbatim): max 15
// words per bullet, specific real segment names, the company's own
// vocabulary from the research.
//
// A JSON parse failure or zod validation failure (fewer than 2 valid
// segments) is a step error, never a partial write (both segments[0] and
// segments[1] must exist, else error).

import { readFileSync } from "node:fs";

import type { LeadRow } from "../db.js";
import { type StepModule, type StepResult } from "../pipeline.js";
import { icpSegmentsSchema, icpSegmentsJsonSchema } from "../pure/aiSchemas.js";
import { extractJsonObject } from "../pure/extractJson.js";
import { interpolatePrompt } from "../pure/interpolatePrompt.js";
import { toHttpUrl } from "../pure/normalize.js";
import { runLlm } from "../providers/llm.js";

const PROMPT_TEMPLATE = readFileSync(new URL("../../prompts/icp-segments.txt", import.meta.url), "utf-8");
const TIMEOUT_MS = 100_000;

interface CompanyFields {
  name?: unknown;
  domain?: unknown;
  website?: unknown;
  linkedin_url?: unknown;
}

function readCompanyFields(lead: LeadRow): CompanyFields {
  const companyData = lead.company_data as { merged?: CompanyFields } | null | undefined;
  return companyData?.merged ?? {};
}

function readResearchResponse(lead: LeadRow): string | null {
  const research = lead.research as { response?: unknown } | null | undefined;
  return typeof research?.response === "string" ? research.response : null;
}

async function run(lead: LeadRow): Promise<StepResult> {
  const merged = readCompanyFields(lead);
  const companyName =
    typeof merged.name === "string" && merged.name.length > 0
      ? merged.name
      : typeof lead.company === "string"
        ? lead.company
        : null;
  const domain = typeof merged.domain === "string" ? merged.domain : null;
  const url = toHttpUrl(typeof merged.website === "string" ? merged.website : domain) ?? "";
  const linkedin = typeof merged.linkedin_url === "string" ? merged.linkedin_url : "";
  const research = readResearchResponse(lead);

  if (!companyName) {
    return { skipped: "no company name available for icp segments" };
  }
  if (!research) {
    return { skipped: "no research response available" };
  }

  const prompt = interpolatePrompt(PROMPT_TEMPLATE, {
    Company: companyName,
    domain: domain ?? "",
    url,
    linkedin,
    research,
  });
  const result = await runLlm(prompt, {
    tier: "sonnet",
    timeoutMs: TIMEOUT_MS,
    jsonSchema: icpSegmentsJsonSchema,
  });

  const parsed = extractJsonObject(result.text);
  const validated = icpSegmentsSchema.parse(parsed);

  const data: Record<string, unknown> = {
    segments: validated.segments,
    raw: result.raw,
  };
  if (result.subscription) data.cost_note = "claude subscription, not per-call billed";
  else if (result.cost_usd === null) data.cost_unknown = true;

  return {
    data,
    cost_usd: result.subscription ? 0 : (result.cost_usd ?? 0),
    provider: result.provider,
  };
}

const step: StepModule = {
  name: "icp_segments",
  column: "icp_segments",
  dependsOn: ["research"],
  timeoutMs: 110_000,
  maxRetries: 1,
  run,
};

export default step;
