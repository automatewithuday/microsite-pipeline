// Opens (and initializes the schema of) the local SQLite file. Deliberately
// free of any src/db.ts import so scripts/init.ts can create the database
// BEFORE the user has filled in .env (importing db.ts would fail-fast on a
// missing required key). Callers pass the path explicitly.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

// One row per lead: id + the indexed lookup columns, plus the full LeadRow as
// a JSON `doc`. See src/state/local.ts for the read-modify-write concurrency
// rationale.
export function openLocalDb(dbPath: string): Database.Database {
  const path = resolve(process.cwd(), dbPath);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(
    `CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      linkedin_url TEXT UNIQUE,
      created_at TEXT NOT NULL,
      doc TEXT NOT NULL
    );`
  );
  return db;
}
