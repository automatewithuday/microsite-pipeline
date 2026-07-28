// Shared thin client for every Apify actor call used by steps 04 to 06.
// Mirrors the pattern already used ad hoc in 02_enrichCompany.ts's
// runApifyLiCompanyActor, generalized so 04/05x3 do not each hand-roll an
// ApifyClient. Confirmed against apify-client's published .d.ts
// (node_modules/apify-client/dist/resource_clients/actor.d.ts): the
// ActorRun returned by `.call()` carries an optional `usageTotalUsd: number`
// field alongside the older `usage`/`usageUsd` breakdown.
//
// Live validation against real runs (2026-07-23): reading
// only `usageTotalUsd` was returning null/0 in production even for billed
// runs, live cost logging real 0 the entire time steps 04/05 ran. Apify's
// per-run cost accounting can lag `usageTotalUsd` on the ActorRun object
// returned immediately by `.call()`; `usageUsd`, the per-category cost
// breakdown object, is populated at the same time and its values sum to the
// same total. We now sum `usageUsd` as a fallback when `usageTotalUsd` is
// absent, and only fall back to `runCost_usd: null` (cost_unknown, never a
// fabricated 0) when neither is present.

import { ApifyClient } from "apify-client";
import { APIFY_TOKEN } from "../db.js";

// Bounded re-fetch of a settled run cost. Kept small so a genuinely free
// run (cost stays 0) adds at most COST_REFETCH_ATTEMPTS * COST_REFETCH_DELAY_MS.
const COST_REFETCH_ATTEMPTS = 3;
const COST_REFETCH_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RunActorResult {
  items: unknown[];
  runCost_usd: number | null;
  runId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Sums an ActorRunUsage-shaped cost breakdown object (e.g. `run.usageUsd`,
 * keyed by resource category like ACTOR_COMPUTE_UNITS, DATASET_READS, ...).
 * Returns null (never a fabricated 0) when the object has no numeric
 * entries at all, so a genuinely-missing breakdown is distinguishable from
 * a legitimately free run.
 */
function sumUsageBreakdown(usage: unknown): number | null {
  if (!isRecord(usage)) return null;
  let total = 0;
  let sawNumber = false;
  for (const value of Object.values(usage)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
      sawNumber = true;
    }
  }
  return sawNumber ? total : null;
}

function readRunCostUsd(run: unknown): number | null {
  if (!isRecord(run)) return null;
  if (typeof run.usageTotalUsd === "number" && Number.isFinite(run.usageTotalUsd)) {
    return run.usageTotalUsd;
  }
  return sumUsageBreakdown(run.usageUsd);
}

/**
 * Runs one Apify actor to completion and returns its full dataset items
 * array (never trimmed) plus whatever cost the client reports. `timeoutMs`
 * is passed through as the actor call's `timeout` (seconds, per apify-client
 * ActorStartOptions) so a stuck actor cannot hang a step past its own
 * pipeline-level timeout.
 */
export async function runActor(
  actorId: string,
  input: Record<string, unknown>,
  options: { timeoutMs: number }
): Promise<RunActorResult> {
  const client = new ApifyClient({ token: APIFY_TOKEN });
  const run = await client.actor(actorId).call(input, {
    timeout: Math.ceil(options.timeoutMs / 1000),
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  // Apify settles a run's cost a beat after `.call()` resolves: for
  // pay-per-event actors usageTotalUsd is present but 0 on the object
  // returned by `.call()`, then updates to the real figure moments later
  // (confirmed live 2026-07-23: an s-r/linkedin run read 0 inline but 0.12
  // once re-fetched). Re-fetch the run and briefly retry while the cost is
  // still 0 or absent, so we log the real spend rather than a false 0.
  let runCost_usd = readRunCostUsd(run);
  for (let attempt = 0; attempt < COST_REFETCH_ATTEMPTS && !runCost_usd; attempt++) {
    await sleep(COST_REFETCH_DELAY_MS);
    const refreshed = await client.run(run.id).get();
    runCost_usd = readRunCostUsd(refreshed);
  }

  return { items, runCost_usd, runId: run.id };
}
