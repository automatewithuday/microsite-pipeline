// The state backend interface. Extends the pipeline's Persistence (the
// writeColumn/markStep seam every step already runs through) with the
// fetch/seed/artifact operations the entry-point scripts and the render
// post-pass need. Implemented by ./local.ts (SQLite + ./output files),
// exposed via ./index.ts.

import type { LeadRow } from "../db.js";
import type { Persistence } from "../pipeline.js";

/** A lead as accepted by upsertLeads (seed + ad-hoc single-lead entry). */
export interface SeedLead {
  linkedin_url: string;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  position?: string | null;
  // Optional pre-seeded step column, used by the ad-hoc single-lead path to
  // seed company_data.merged when Deepline is absent (graceful degradation).
  company_data?: unknown;
}

// "report.md" and "research.md" are the inspect exports (scripts/inspect.ts):
// the per-lead readable report and the full step-07 research text.
export type ArtifactKind = "pdf" | "html" | "report.md" | "research.md" | "followup.html" | "followup.md";

export interface StateBackend extends Persistence {
  /** Fetch one lead by id, or null if it does not exist. */
  getLead(id: string): Promise<LeadRow | null>;
  /** Fetch one lead by its unique linkedin_url, or null. */
  getLeadByLinkedinUrl(url: string): Promise<LeadRow | null>;
  /**
   * Fetch a bounded, oldest-first candidate pool, filter it with `isPending`,
   * and return at most `limit` rows. `isPending` carries the STEPS knowledge
   * so the backend stays generic.
   */
  listPending(limit: number, isPending: (lead: LeadRow) => boolean): Promise<LeadRow[]>;
  /** Upsert leads keyed on linkedin_url. Returns the number written. */
  upsertLeads(leads: SeedLead[]): Promise<number>;
  /**
   * Persist a rendered artifact and return a URL/path to store in the `render`
   * column. For "pdf" this writes bytes and returns a resolvable location; for
   * "html" it writes the file and returns its path.
   */
  writeArtifact(leadId: string, kind: ArtifactKind, bytes: Buffer): Promise<string>;
}
