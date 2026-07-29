// Registry of deck template variants. Single source of truth for template
// names and the font files each build inlines. Consumed by
// scripts/build-deck-template.ts (build), src/render.ts (per-lead
// resolution), and scripts/seed.ts (CSV validation). Pure: no I/O; the
// caller passes the DECK_TEMPLATE env value in.
import type { LeadRow } from "../db.js";

export interface DeckFont {
  file: string;
  family: string;
  weight: number;
  style: "normal" | "italic";
}

export interface DeckTemplateDef {
  name: string;
  fonts: DeckFont[];
}

export const DECK_TEMPLATES: Record<string, DeckTemplateDef> = {
  microsite: {
    name: "microsite",
    fonts: [
      { file: "fraunces-300.woff2", family: "Fraunces", weight: 300, style: "normal" },
      { file: "fraunces-300i.woff2", family: "Fraunces", weight: 300, style: "italic" },
      { file: "fraunces-400.woff2", family: "Fraunces", weight: 400, style: "normal" },
      { file: "fraunces-400i.woff2", family: "Fraunces", weight: 400, style: "italic" },
      { file: "fraunces-600.woff2", family: "Fraunces", weight: 600, style: "normal" },
      { file: "fraunces-600i.woff2", family: "Fraunces", weight: 600, style: "italic" },
      { file: "plex-400.woff2", family: "IBM Plex Sans", weight: 400, style: "normal" },
      { file: "plex-500.woff2", family: "IBM Plex Sans", weight: 500, style: "normal" },
      { file: "plex-600.woff2", family: "IBM Plex Sans", weight: 600, style: "normal" },
      { file: "plex-cond-600.woff2", family: "IBM Plex Sans Condensed", weight: 600, style: "normal" },
    ],
  },
  "microsite-signal": {
    name: "microsite-signal",
    fonts: [
      { file: "archivo-400.woff2", family: "Archivo", weight: 400, style: "normal" },
      { file: "archivo-500.woff2", family: "Archivo", weight: 500, style: "normal" },
      { file: "archivo-700.woff2", family: "Archivo", weight: 700, style: "normal" },
      { file: "archivo-expanded-700.woff2", family: "Archivo Expanded", weight: 700, style: "normal" },
      { file: "geistmono-400.woff2", family: "Geist Mono", weight: 400, style: "normal" },
    ],
  },
};

export const DEFAULT_DECK_TEMPLATE = "microsite";

export function assertDeckTemplateName(name: string): void {
  if (!(name in DECK_TEMPLATES)) {
    throw new Error(
      `unknown deck template "${name}" (valid: ${Object.keys(DECK_TEMPLATES).join(", ")})`
    );
  }
}

/**
 * Per-lead template resolution: the lead's `template` doc field wins, then
 * the DECK_TEMPLATE env value passed by the caller, then the default. Throws
 * on an unknown name so applyRender records a loud step error (a config typo
 * must never silently render the wrong deck).
 */
export function resolveDeckTemplate(lead: LeadRow, envValue: string | undefined): string {
  const fromLead = typeof lead.template === "string" && lead.template.length > 0 ? lead.template : null;
  const fromEnv = envValue && envValue.length > 0 ? envValue : null;
  const name = fromLead ?? fromEnv ?? DEFAULT_DECK_TEMPLATE;
  assertDeckTemplateName(name);
  return name;
}
