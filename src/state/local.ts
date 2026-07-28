// Local state backend: a single SQLite file (better-sqlite3) + rendered
// artifacts under ./output. Zero external infrastructure — a user can run the
// pipeline with only an ANTHROPIC_API_KEY.
//
// Concurrency: runBatch runs several lead workers with awaits between
// writeColumn and markStep. better-sqlite3 is synchronous, so each
// read-modify-write below completes fully within one JS turn (no await in the
// critical section) before the event loop yields to another worker, keeping
// the step_status merge atomic under concurrent workers.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type Database from "better-sqlite3";
import { LOCAL_DB_PATH, OUTPUT_DIR, type LeadRow } from "../db.js";
import type { MarkStepInput } from "../pipeline.js";
import { openLocalDb } from "./localDb.js";
import type { ArtifactKind, SeedLead, StateBackend } from "./types.js";

let db: Database.Database | null = null;

// writeColumn/markStep mutate keys inside `doc`; the mirror columns
// (linkedin_url, created_at) are maintained at upsert time for ORDER BY /
// conflict handling. Opened lazily so importing this module never touches disk.
function getDb(): Database.Database {
  if (!db) db = openLocalDb(LOCAL_DB_PATH);
  return db;
}

function parseDoc(row: { doc: string } | undefined): LeadRow | null {
  if (!row) return null;
  const lead = JSON.parse(row.doc) as LeadRow;
  if (!lead.step_status || typeof lead.step_status !== "object") lead.step_status = {};
  return lead;
}

function readDoc(id: string): LeadRow | null {
  const row = getDb().prepare("SELECT doc FROM leads WHERE id = ?").get(id) as
    | { doc: string }
    | undefined;
  return parseDoc(row);
}

function writeDoc(lead: LeadRow): void {
  getDb()
    .prepare("UPDATE leads SET doc = ?, linkedin_url = ?, created_at = ? WHERE id = ?")
    .run(
      JSON.stringify(lead),
      typeof lead.linkedin_url === "string" ? lead.linkedin_url : null,
      typeof lead.created_at === "string" ? lead.created_at : new Date().toISOString(),
      String(lead.id)
    );
}

export const localBackend: StateBackend = {
  async writeColumn(leadId, column, data) {
    const lead = readDoc(leadId);
    if (!lead) throw new Error(`writeColumn: lead ${leadId} not found`);
    lead[column] = data;
    writeDoc(lead);
  },

  async markStep(leadId, step, entry: MarkStepInput) {
    const lead = readDoc(leadId);
    if (!lead) throw new Error(`markStep: lead ${leadId} not found`);
    lead.step_status = {
      ...(lead.step_status ?? {}),
      [step]: { ...entry, at: new Date().toISOString() },
    };
    writeDoc(lead);
  },

  async getLead(id) {
    return readDoc(id);
  },

  async getLeadByLinkedinUrl(url) {
    const row = getDb().prepare("SELECT doc FROM leads WHERE linkedin_url = ?").get(url) as
      | { doc: string }
      | undefined;
    return parseDoc(row);
  },

  async listPending(limit, isPending) {
    const candidatePoolSize = Math.max(limit * 20, 500);
    const rows = getDb()
      .prepare("SELECT doc FROM leads ORDER BY created_at ASC LIMIT ?")
      .all(candidatePoolSize) as Array<{ doc: string }>;
    const leads = rows.map((r) => parseDoc(r)).filter((l): l is LeadRow => l !== null);
    return leads.filter(isPending).slice(0, limit);
  },

  async upsertLeads(leads: SeedLead[]) {
    const database = getDb();
    const upsertOne = database.transaction((seed: SeedLead) => {
      const existing = database
        .prepare("SELECT id, doc FROM leads WHERE linkedin_url = ?")
        .get(seed.linkedin_url) as { id: string; doc: string } | undefined;

      if (existing) {
        // Overwrite only the provided fields, preserve existing step outputs
        // + step_status.
        const merged = { ...(JSON.parse(existing.doc) as LeadRow), ...seed, id: existing.id };
        writeDoc(merged as LeadRow);
        return;
      }

      const lead: LeadRow = {
        id: randomUUID(),
        step_status: {},
        created_at: new Date().toISOString(),
        ...seed,
      } as LeadRow;
      database
        .prepare("INSERT INTO leads (id, linkedin_url, created_at, doc) VALUES (?, ?, ?, ?)")
        .run(String(lead.id), seed.linkedin_url, String(lead.created_at), JSON.stringify(lead));
    });

    for (const seed of leads) upsertOne(seed);
    return leads.length;
  },

  async writeArtifact(leadId: string, kind: ArtifactKind, bytes: Buffer) {
    const dir = resolve(process.cwd(), OUTPUT_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filePath = resolve(dir, `${leadId}.${kind}`);
    writeFileSync(filePath, bytes);
    return pathToFileURL(filePath).href;
  },
};
