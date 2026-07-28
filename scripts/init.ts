// First-run helper. Creates .env from the template, the ./output directory,
// and the SQLite database. Deliberately does NOT import
// src/db.ts: it runs BEFORE the user has filled in .env, and db.ts fail-fasts
// on a missing required key. Reads the couple of vars it needs straight from
// process.env with the same defaults db.ts uses.

import "dotenv/config";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openLocalDb } from "../src/state/localDb.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function main(): void {
  // 1. .env from the template.
  const envPath = path.join(repoRoot, ".env");
  const examplePath = path.join(repoRoot, ".env.example");
  if (existsSync(envPath)) {
    console.log(".env already exists, leaving it untouched.");
  } else if (existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    chmodSync(envPath, 0o600); // will hold real keys — same mode the wizard uses
    console.log("Created .env from .env.example. Fill in ANTHROPIC_API_KEY (and any optional keys).");
  } else {
    console.log("No .env.example found, skipping .env creation.");
  }

  // 2. Output directory.
  const outputDir = path.resolve(repoRoot, process.env.OUTPUT_DIR || "output");
  mkdirSync(outputDir, { recursive: true });
  console.log(`Output directory ready: ${outputDir}`);

  // 3. Local SQLite database.
  const dbPath = process.env.LOCAL_DB_PATH || "local.db";
  const db = openLocalDb(dbPath);
  db.close();
  console.log(`Local SQLite database ready: ${path.resolve(repoRoot, dbPath)}`);

  console.log(
    [
      "",
      "Next steps:",
      "  1. Put your ANTHROPIC_API_KEY in .env (and any optional provider keys).",
      "  2. Check what will run:   npx tsx scripts/doctor.ts",
      "  3. Generate a microsite:  npx tsx scripts/run.ts --lead-url <linkedin> --name <name> --company <domain>",
      "  4. View it:               npx tsx scripts/serve.ts   (then open the printed URL)",
    ].join("\n")
  );
}

main();
