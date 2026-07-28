// Exposes the local state backend (SQLite + ./output). The backend object is
// lazy (it opens the DB on first method call), so importing this module never
// touches the filesystem until a method actually runs.

import { localBackend } from "./local.js";
import type { StateBackend } from "./types.js";

export function getStateBackend(): StateBackend {
  return localBackend;
}

export type { StateBackend, SeedLead, ArtifactKind } from "./types.js";
