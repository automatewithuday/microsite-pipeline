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
