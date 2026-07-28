// One-off extraction: turn the Claude Design self-unpacking bundle at
// templates/microsite/source-bundle.html into a standalone, self-contained
// template at templates/microsite/index.html that Playwright can setContent()
// with no network.
//
// The bundle carries three JSON <script> blocks:
//   __bundler/manifest       uuid -> { mime, compressed, data(base64) }
//   __bundler/ext_resources  [{ id, uuid }]   (react/react-dom CDN, unused here)
//   __bundler/template       a JSON string: the REAL standalone HTML, with
//                            font urls written as url("<uuid>")
// We extract the template string, inline every referenced font uuid as a
// data: URI (fonts ship uncompressed base64 woff2 in the manifest), strip the
// bundle's own loader <script> that pulls in 0caf...js, add data-slot anchors
// to the two numbered insight cards, and write the result.
//
// Run once (re-run only if the design export changes):
//   npx tsx scripts/extract-template.ts
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../templates/microsite/source-bundle.html");
const OUT = resolve(here, "../templates/microsite/index.html");

interface ManifestEntry {
  mime: string;
  compressed: boolean;
  data: string;
}

function extractScriptJson(bundle: string, type: string): string {
  const open = `<script type="${type}">`;
  const start = bundle.indexOf(open);
  if (start === -1) throw new Error(`missing <script type="${type}"> in bundle`);
  const contentStart = start + open.length;
  const end = bundle.indexOf("</script>", contentStart);
  if (end === -1) throw new Error(`unterminated <script type="${type}"> in bundle`);
  return bundle.slice(contentStart, end).trim();
}

async function main(): Promise<void> {
  const bundle = await readFile(SRC, "utf8");

  const manifest: Record<string, ManifestEntry> = JSON.parse(
    extractScriptJson(bundle, "__bundler/manifest")
  );
  // __bundler/template holds a JSON STRING whose value is the real HTML.
  const template: string = JSON.parse(extractScriptJson(bundle, "__bundler/template"));

  let html = template;

  // Drop the bundle's own loader <script src="<uuid>"> (the gzipped unpacker):
  // the extracted standalone page is the final DOM and needs no unpacker.
  html = html.replace(/<script\s+src="[0-9a-f-]{36}"><\/script>\s*/gi, "");

  // Inline every manifest uuid the template still references (fonts) as a
  // data: URI. Fonts ship uncompressed (compressed:false); skip any remaining
  // compressed entries (loader/JS assets), which are not needed for the PDF.
  let inlined = 0;
  for (const [uuid, entry] of Object.entries(manifest)) {
    if (!html.includes(uuid)) continue;
    if (entry.compressed) continue; // JS/loader asset, not a font we inline
    const dataUri = `data:${entry.mime};base64,${entry.data}`;
    html = html.split(uuid).join(dataUri);
    inlined += 1;
  }
  console.log(`Inlined ${inlined} font asset(s).`);

  // Add data-slot anchors to the two numbered insight cards so null
  // [Point 1] / [Point 2] can remove the whole card block (src/pure removeSlot).
  // The cards are the two <div ...min-height:180px;> blocks whose body holds
  // [Point 1] / [Point 2]. Anchor on the "01"/"02" numbered card wrappers.
  html = tagInsightCard(html, "[Point 1]", "point1");
  html = tagInsightCard(html, "[Point 2]", "point2");

  await writeFile(OUT, html, "utf8");
  console.log(`Wrote ${OUT} (${html.length} bytes)`);
}

// Find the insight-card <div> that CONTAINS `token` and add data-slot="<slot>"
// to that card's opening tag. The card is the nearest enclosing
// <div ...min-height:180px;...> before the token.
function tagInsightCard(html: string, token: string, slot: string): string {
  if (html.includes(`data-slot="${slot}"`)) return html;
  const tokenIdx = html.indexOf(token);
  if (tokenIdx === -1) throw new Error(`token ${token} not found in template`);
  // Card wrappers use min-height:180px; find the last such <div open tag before the token.
  const marker = "min-height:180px;";
  const cardBodyIdx = html.lastIndexOf(marker, tokenIdx);
  if (cardBodyIdx === -1) throw new Error(`no insight card wrapper before ${token}`);
  const openStart = html.lastIndexOf("<div", cardBodyIdx);
  const openEnd = html.indexOf(">", cardBodyIdx);
  if (openStart === -1 || openEnd === -1) throw new Error(`malformed card around ${token}`);
  return (
    html.slice(0, openEnd) + ` data-slot="${slot}"` + html.slice(openEnd)
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
