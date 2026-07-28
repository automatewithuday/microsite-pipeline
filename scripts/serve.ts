// Minimal local viewer for rendered microsites. Serves the decks written by
// the render step:
//   GET /               -> index of leads that have a rendered deck
//   GET /d/<leadId>      -> the stored rendered_html
//   GET /d/<leadId>.pdf  -> the PDF (streamed from ./output)

import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import type { LeadRow } from "../src/db.js";
import { getStateBackend } from "../src/state/index.js";

const state = getStateBackend();
const PORT = Number(process.env.PORT ?? 4321);
// Lead decks are private data — serve to this machine only unless the user
// explicitly opts into another interface via HOST.
const HOST = process.env.HOST ?? "127.0.0.1";

function renderRecord(lead: LeadRow): { pdfUrl?: string } {
  const r = lead.render;
  return r && typeof r === "object" ? (r as { pdfUrl?: string }) : {};
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const p = url.pathname;

    // Index of rendered decks.
    if (p === "/") {
      const leads = await state.listPending(500, () => true);
      const rendered = leads.filter((l) => typeof l.rendered_html === "string" && l.rendered_html);
      const items = rendered
        .map((l) => {
          const id = String(l.id);
          const name = escapeHtml(String(l.company ?? l.linkedin_url ?? id));
          return `<li><a href="/d/${id}">${name}</a> &middot; <a href="/d/${id}.pdf">PDF</a></li>`;
        })
        .join("\n");
      const body = rendered.length
        ? `<ul>${items}</ul>`
        : "<p>No rendered microsites yet. Run <code>scripts/run.ts</code> first.</p>";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>Microsites</title><h1>Microsites</h1>${body}`);
      return;
    }

    const pdfMatch = /^\/d\/([^/]+)\.pdf$/.exec(p);
    if (pdfMatch) {
      const lead = await state.getLead(pdfMatch[1]!);
      const pdfUrl = lead ? renderRecord(lead).pdfUrl : undefined;
      if (!pdfUrl) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("PDF not found");
        return;
      }
      // The state backend stores file:// URLs; stream the PDF from disk.
      const filePath = fileURLToPath(pdfUrl);
      if (!existsSync(filePath)) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("PDF file missing on disk");
        return;
      }
      res.writeHead(200, { "content-type": "application/pdf" });
      createReadStream(filePath).pipe(res);
      return;
    }

    const htmlMatch = /^\/d\/([^/]+)$/.exec(p);
    if (htmlMatch) {
      const lead = await state.getLead(htmlMatch[1]!);
      const html = lead && typeof lead.rendered_html === "string" ? lead.rendered_html : null;
      if (!html) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Microsite not found");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(err instanceof Error ? err.message : String(err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Microsite viewer running at http://localhost:${PORT}`);
  console.log(`  Index:   http://localhost:${PORT}/`);
  console.log(`  A deck:  http://localhost:${PORT}/d/<leadId>`);
});
