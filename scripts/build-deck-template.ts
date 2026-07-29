// Combines each variant's templates/<name>/index.src.html with its subset
// woff2 fonts into the self-contained templates/<name>/index.html that
// render.ts reads. Re-run after editing an index.src.html or its fonts:
//   npx tsx scripts/build-deck-template.ts                    # all variants
//   npx tsx scripts/build-deck-template.ts microsite-signal   # one variant
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DECK_TEMPLATES, assertDeckTemplateName } from "../src/pure/deckTemplates.js";

const here = dirname(fileURLToPath(import.meta.url));
const MARKER = "/*__DECK_FONTS__*/";

async function buildOne(name: string): Promise<void> {
  const def = DECK_TEMPLATES[name]!;
  const dir = resolve(here, `../templates/${name}`);
  const srcPath = resolve(dir, "index.src.html");
  const src = await readFile(srcPath, "utf8");
  if (!src.includes(MARKER)) throw new Error(`marker ${MARKER} missing in ${srcPath}`);
  const faces = await Promise.all(
    def.fonts.map(async (f) => {
      const data = await readFile(resolve(dir, "fonts", f.file));
      return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url("data:font/woff2;base64,${data.toString("base64")}") format("woff2");}`;
    })
  );
  const out = src.replace(MARKER, faces.join("\n"));
  await writeFile(resolve(dir, "index.html"), out, "utf8");
  console.log(`wrote ${dir}/index.html (${Math.round(out.length / 1024)} KB)`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg) assertDeckTemplateName(arg);
  const names = arg ? [arg] : Object.keys(DECK_TEMPLATES);
  for (const name of names) await buildOne(name);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
