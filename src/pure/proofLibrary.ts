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
  // A case study with no metric renders an empty proof block — require one.
  // Platforms may ship with metrics: [] (the template hides the block there).
  metrics: z.array(metricSchema).min(1),
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
    .map(
      (c) =>
        `- case "${c.id}": ${c.client} | ${c.verticalTags.join(", ")} | ${c.motionTags.join(", ")} | ${c.problem}`
    )
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
