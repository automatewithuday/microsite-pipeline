// Post-step routine (not a registered pipeline.ts step, deliberately: it
// writes two columns -- `qualified` and `derived` -- and StepModule.column
// only supports one). Deterministic, no LLM calls.
// Callers (scripts/run.ts) run this once steps 01-12 have landed on a lead,
// passing a freshly-fetched lead row so every dependency's latest column
// data is visible.

import type { LeadRow } from "./db.js";
import type { Persistence } from "./pipeline.js";
import { computeDerived, type DerivedResult } from "./pure/derived.js";

export async function applyDerived(lead: LeadRow, persistence: Persistence): Promise<DerivedResult> {
  const result = computeDerived(lead);
  const leadId = String(lead.id);
  await persistence.writeColumn(leadId, "qualified", result.qualified);
  await persistence.writeColumn(leadId, "derived", result.derived);
  return result;
}
