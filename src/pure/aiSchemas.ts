// Zod schemas enforcing the JSON shape of steps 10-12's LLM output
// (LLM steps use schemas, a malformed
// response is a step error, not a partial write). No I/O, no LLM calls.
// These validate the object already produced by extractJsonObject(); when
// we flip steps 10-12 from the claude CLI to the Anthropic API's tool-use,
// the same schemas double as the tool-use input schema source of truth.

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

function wordCount(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

// Derives a plain JSON Schema (no $schema/$ref wrapper) from a zod schema, for
// use as a tool-use input_schema on the Anthropic API path (LLM_PROVIDER=api).
// The tool schema is only a shape hint that gets the model to emit the right
// keys; the zod schema above remains the enforcing validator after parse, so
// constraints zod expresses but JSON Schema/tool-use cannot (word counts,
// tuple length) are still checked. See steps 10-12.
function toToolSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const js = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

// Step 10 (tam). 0/absent/invalid -> step error (the deck's page 4 needs it):
// z.number().int().positive() already rejects 0, negatives, non-integers,
// and non-numbers, and z.object rejects a missing key.
export const tamSchema = z.object({
  tamEstimation: z.number().int().positive(),
  // Optional scenario counts (Realistic/Conservative filtered company counts).
  // Present when the research brief sizes the market under three scenarios;
  // omitted when it yields only a single number, in which case computeDerived
  // falls back to the adjustedTam/adjustedTam2 multipliers.
  tamRealistic: z.number().int().positive().optional(),
  tamConservative: z.number().int().positive().optional(),
});
export type TamResult = z.infer<typeof tamSchema>;

// Step 11 (icp_segments). The deck reads segments[0] and segments[1], so at
// least 2 are required; output is capped at 4.
export const icpSegmentSchema = z.object({
  segmentName: z.string().min(1),
  companyCharacteristic: z.string().min(1),
  keyPainPoint: z.string().min(1),
  primaryBuyer: z.string().min(1),
  differentiatingNeed: z.string().min(1),
});
export const icpSegmentsSchema = z.object({
  segments: z.array(icpSegmentSchema).min(2).max(4),
});
export type IcpSegmentsResult = z.infer<typeof icpSegmentsSchema>;

// Step 12 (sales_signals). Exactly 3 signals, each capped at 25 words.
// z.tuple enforces exactly 3 (unlike
// z.array().length(3), a tuple also fixes each position's type at the type
// level); the .refine enforces the word cap per element, since zod has no
// built-in word-count constraint.
export const salesSignalsSchema = z.object({
  signals: z
    .tuple([z.string().min(1), z.string().min(1), z.string().min(1)])
    .refine((signals) => signals.every((s) => wordCount(s) <= 25), {
      message: "each signal must be 25 words or fewer",
    }),
});
export type SalesSignalsResult = z.infer<typeof salesSignalsSchema>;

// Tool-use input schemas for the Anthropic API path (LLM_PROVIDER=api).
export const tamJsonSchema = toToolSchema(tamSchema);
export const icpSegmentsJsonSchema = toToolSchema(icpSegmentsSchema);

// The tool schema for sales_signals is built from an equivalent uniform-array
// zod shape, NOT salesSignalsSchema itself: zod-to-json-schema emits z.tuple
// as draft-07 array-form "items", which the Anthropic API rejects (it
// enforces draft 2020-12; live-observed 400 on 2026-07-28). All three tuple
// positions are identical strings, so array+min/max 3 expresses the same
// shape; salesSignalsSchema remains the enforcing validator after parse.
export const salesSignalsJsonSchema = toToolSchema(
  z.object({ signals: z.array(z.string().min(1)).min(3).max(3) })
);

export { wordCount };
