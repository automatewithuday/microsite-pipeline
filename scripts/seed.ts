// Reads leads.csv from the repo root and upserts rows into the `leads` table,
// keyed on linkedin_url. Columns (case-insensitive): URL/url/linkedin_url,
// first_name, last_name, company, position.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStateBackend } from "../src/state/index.js";

const state = getStateBackend();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(__dirname, "..", "leads.csv");

const URL_HEADER_ALIASES = new Set(["url", "linkedin_url"]);

/**
 * Minimal RFC4180-ish CSV parser: comma-separated fields, double-quoted
 * fields may contain commas/newlines, doubled quotes escape a literal quote.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // skip, \n handles the row break
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

interface ParsedLead {
  linkedin_url: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  position: string | null;
}

function toLeads(rows: string[][]): { leads: ParsedLead[]; skipped: number[] } {
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) return { leads: [], skipped: [] };

  const headers = headerRow.map((h) => h.trim().toLowerCase());
  const urlIdx = headers.findIndex((h) => URL_HEADER_ALIASES.has(h));
  const firstNameIdx = headers.indexOf("first_name");
  const lastNameIdx = headers.indexOf("last_name");
  const companyIdx = headers.indexOf("company");
  const positionIdx = headers.indexOf("position");

  if (urlIdx === -1) {
    throw new Error(
      "leads.csv is missing a URL column. Expected one of: url, linkedin_url."
    );
  }

  const leads: ParsedLead[] = [];
  const skipped: number[] = [];

  dataRows.forEach((row, i) => {
    const rowNumber = i + 2; // 1-indexed, plus header row
    const linkedinUrl = row[urlIdx]?.trim();

    if (!linkedinUrl) {
      skipped.push(rowNumber);
      return;
    }

    leads.push({
      linkedin_url: linkedinUrl,
      first_name: firstNameIdx >= 0 ? row[firstNameIdx]?.trim() || null : null,
      last_name: lastNameIdx >= 0 ? row[lastNameIdx]?.trim() || null : null,
      company: companyIdx >= 0 ? row[companyIdx]?.trim() || null : null,
      position: positionIdx >= 0 ? row[positionIdx]?.trim() || null : null,
    });
  });

  return { leads, skipped };
}

async function main() {
  if (!existsSync(csvPath)) {
    console.error(
      "No leads.csv found in the repo root. Add one with a header row " +
        "(url, first_name, last_name, company, position) and rerun this script."
    );
    process.exitCode = 1;
    return;
  }

  const text = readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  const { leads, skipped } = toLeads(rows);

  for (const rowNumber of skipped) {
    console.warn(`Skipping row ${rowNumber}: no linkedin URL.`);
  }

  if (leads.length === 0) {
    console.log("No rows with a linkedin URL to upsert.");
    return;
  }

  try {
    const count = await state.upsertLeads(leads);
    console.log(`Upserted ${count} lead(s).`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();
