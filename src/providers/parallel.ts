// Thin client for the Parallel Task API's deep research feature (primary
// research provider). Docs-derived (docs.parallel.ai/task-api/
// task-deep-research, confirmed 2026-07-23 via search + doc fetch, not
// live-tested): create a task run, then poll for
// its result. Auth is the `x-api-key` header, not `Authorization`.
//
// UNVERIFIED: the docs excerpt available during this build did not show a
// confirmed cost/usage field on the result response. extractCost() checks a
// handful of candidate field names and returns null when none are present,
// so the caller (07_research.ts) can flag cost_unknown instead of silently
// recording a fabricated or hidden $0. Needs live validation to find a real
// usage field, if one exists, and to confirm the "pro" processor choice
// below (deep research is documented as available on "pro" and "ultra"
// tiers; "pro" is chosen here as the cheaper of the two, a judgment call
// flagged for human review, not a documented default).

import { PARALLEL_API_KEY } from "../db.js";

const BASE_URL = "https://api.parallel.ai";
const PROCESSOR = "pro";
const POLL_INTERVAL_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Candidate cost field names, checked in order, at both the top level and
// under a nested `usage` or `billing` object. Returns null (never a
// fabricated estimate) when none are present, so the caller can flag
// cost_unknown.
const COST_FIELD_CANDIDATES = ["cost_usd", "total_cost_usd", "usd", "cost"];

function extractCost(body: Record<string, unknown>): number | null {
  const output = isRecord(body.output) ? body.output : null;
  const containers = [body, output, output && isRecord(output.usage) ? output.usage : null, isRecord(body.usage) ? body.usage : null, isRecord(body.billing) ? body.billing : null].filter(
    isRecord
  );

  for (const container of containers) {
    for (const key of COST_FIELD_CANDIDATES) {
      const value = container[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return null;
}

export interface DeepResearchResult {
  text: string;
  raw: unknown;
  /** Real provider cost when a cost field is present; null when not. */
  cost_usd: number | null;
}

export async function runParallelDeepResearch(prompt: string, timeoutMs: number): Promise<DeepResearchResult> {
  const deadline = Date.now() + timeoutMs;

  const createRes = await fetch(`${BASE_URL}/v1/tasks/runs`, {
    method: "POST",
    headers: { "x-api-key": PARALLEL_API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({
      input: prompt,
      processor: PROCESSOR,
      task_spec: { output_schema: { type: "text" } },
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Parallel deep research create failed (${createRes.status}): ${body.slice(0, 500)}`);
  }

  const created = (await createRes.json()) as Record<string, unknown>;
  const runId =
    typeof created.run_id === "string"
      ? created.run_id
      : isRecord(created.output) && typeof created.output.run_id === "string"
        ? created.output.run_id
        : null;

  if (!runId) {
    throw new Error("Parallel deep research create response had no run_id");
  }

  for (;;) {
    const pollRes = await fetch(`${BASE_URL}/v1/tasks/runs/${encodeURIComponent(runId)}/result`, {
      headers: { "x-api-key": PARALLEL_API_KEY ?? "" },
    });

    if (pollRes.ok) {
      const body = (await pollRes.json()) as Record<string, unknown>;
      const output = isRecord(body.output) ? body.output : null;
      const status = output && typeof output.status === "string" ? output.status : undefined;

      if (status === "completed" && output) {
        const content = output.content;
        const text = typeof content === "string" ? content : JSON.stringify(content);
        return { text, raw: body, cost_usd: extractCost(body) };
      }
      if (status === "failed" || status === "error") {
        throw new Error(`Parallel deep research run ${runId} ${status}`);
      }
    }

    if (Date.now() > deadline) {
      throw new Error(`Parallel deep research run ${runId} timed out after ${timeoutMs}ms`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
