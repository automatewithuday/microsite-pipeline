// Combines templates/microsite/index.src.html with the subset woff2 fonts
// into the self-contained templates/microsite/index.html that render.ts
// reads. Re-run after editing index.src.html or the fonts:
//   npx tsx scripts/build-deck-template.ts
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../templates/microsite/index.src.html");
const OUT = resolve(here, "../templates/microsite/index.html");
const FONT_DIR = resolve(here, "../templates/microsite/fonts");

const FONTS: Array<{ file: string; family: string; weight: number; style: "normal" | "italic" }> = [
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
];

const MARKER = "/*__DECK_FONTS__*/";

async function main(): Promise<void> {
  const src = await readFile(SRC, "utf8");
  if (!src.includes(MARKER)) throw new Error(`marker ${MARKER} missing in ${SRC}`);
  const faces = await Promise.all(
    FONTS.map(async (f) => {
      const data = await readFile(resolve(FONT_DIR, f.file));
      return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url("data:font/woff2;base64,${data.toString("base64")}") format("woff2");}`;
    })
  );
  const out = src.replace(MARKER, faces.join("\n"));
  await writeFile(OUT, out, "utf8");
  console.log(`wrote ${OUT} (${Math.round(out.length / 1024)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
