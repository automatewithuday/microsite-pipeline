// DAG runner. Builds execution order from each registered step's `dependsOn`
// declarations, then runs steps for one or many lead rows with retries,
// per-step timeouts, idempotent skipping, and row concurrency.
//
// The step registry (src/steps/index.ts) and this runner accept additional
// steps without structural change.

import type { LeadRow, StepState } from "./db.js";

export type StepResult =
  | { data: unknown; cost_usd: number; provider: string }
  | { skipped: string; cost_usd?: number; provider?: string };

export interface StepModule {
  name: string;
  column: string;
  dependsOn: string[];
  timeoutMs?: number;
  /**
   * Retry cap for thrown transport errors, overriding the default
   * RETRY_BACKOFF_MS.length (2). E.g. 1 means one retry (two attempts
   * total), consuming only the first RETRY_BACKOFF_MS entry. Steps that
   * pay per call on a real provider hit (e.g. research) set this lower so
   * a flaky response does not silently burn extra paid attempts.
   */
  maxRetries?: number;
  run(lead: LeadRow): Promise<StepResult>;
}

// Shape markStep() is called with (the timestamp is added by the
// implementation, e.g. db.ts's markStep RPC wrapper, not supplied here).
// Distinct from db.ts's StepStatusEntry, which is the persisted shape
// including `at` and is not imported here to avoid the name collision.
export interface MarkStepInput {
  state: StepState;
  error?: string | null;
  cost_usd?: number;
  provider?: string;
}

export interface Persistence {
  writeColumn(leadId: string, column: string, data: unknown): Promise<void>;
  markStep(leadId: string, step: string, entry: MarkStepInput): Promise<void>;
}

export interface RunOptions {
  /** Step name to force rerun even if already marked "done". */
  force?: string;
  /** Row concurrency for runBatch. Default 5. */
  concurrency?: number;
}

export type CostSummary = Record<string, number>;

const DEFAULT_TIMEOUT_MS = 120_000;

// 2 retries with exponential backoff after the first attempt (2s, 8s).
export const RETRY_BACKOFF_MS = [2000, 8000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thrown by a step's run() to signal a definitive, deterministic failure
 * (e.g. "no person found" after a completed provider waterfall) that a
 * retry cannot fix. The runner records it as a step error immediately,
 * skipping the usual 2-retry backoff so a known miss does not burn 2 more
 * paid provider calls. Ordinary thrown errors (network blips, timeouts)
 * still go through the normal retry path.
 */
export class NonRetryableError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Runs one step to completion, retrying thrown errors (including timeouts)
 * up to RETRY_BACKOFF_MS.length times with exponential backoff. Throws the
 * last error if every attempt fails.
 */
export async function runStepWithRetries(step: StepModule, lead: LeadRow): Promise<StepResult> {
  const timeoutMs = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = step.maxRetries ?? RETRY_BACKOFF_MS.length;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(step.run(lead), timeoutMs, `step "${step.name}"`);
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      lastError = err;
      if (attempt >= maxRetries) break;
      const delay = RETRY_BACKOFF_MS[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Orders steps so every dependency comes before its dependents. Throws on an
 * unknown dependency name or a dependency cycle, both of which are
 * programming errors in the registry, never a per-row condition.
 */
export function topoSort(steps: StepModule[]): StepModule[] {
  const byName = new Map(steps.map((s) => [s.name, s]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: StepModule[] = [];

  function visit(step: StepModule): void {
    if (visited.has(step.name)) return;
    if (visiting.has(step.name)) {
      throw new Error(`pipeline: circular dependency detected involving step "${step.name}"`);
    }
    visiting.add(step.name);
    for (const depName of step.dependsOn) {
      const dep = byName.get(depName);
      if (!dep) {
        throw new Error(`pipeline: step "${step.name}" depends on unknown step "${depName}"`);
      }
      visit(dep);
    }
    visiting.delete(step.name);
    visited.add(step.name);
    ordered.push(step);
  }

  for (const step of steps) visit(step);
  return ordered;
}

function isSatisfied(step: StepModule, stepStatus: Record<string, { state: StepState }>): boolean {
  return step.dependsOn.every((dep) => {
    const state = stepStatus[dep]?.state;
    return state === "done" || state === "skipped";
  });
}

/**
 * True when at least one registered step on this lead is not yet "done" or
 * "skipped" (including steps that never ran, ended in "error" and are due
 * for an automatic retry on the next batch run, or sit "blocked" behind an
 * errored dependency). `extraStepNames` lets the caller include steps that
 * live outside the DAG registry — scripts/run.ts passes its post-pass names
 * ("derived", "render") so a lead whose DAG finished but whose render
 * errored is still selected by `--batch`.
 */
export function isLeadPending(
  lead: LeadRow,
  steps: StepModule[],
  extraStepNames: string[] = []
): boolean {
  const stepStatus = (lead.step_status ?? {}) as Record<string, { state?: StepState }>;
  const pending = (name: string): boolean => {
    const state = stepStatus[name]?.state;
    return state !== "done" && state !== "skipped";
  };
  return steps.some((step) => pending(step.name)) || extraStepNames.some(pending);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Runs the full DAG for a single lead row against the given persistence.
 * Never throws: a step error is caught, recorded via markStep, and execution
 * continues with the remaining steps. Returns cost_usd summed by step name
 * for steps that completed successfully during this call.
 */
export async function runStepsForLead(
  lead: LeadRow,
  steps: StepModule[],
  persistence: Persistence,
  options: RunOptions = {}
): Promise<CostSummary> {
  const ordered = topoSort(steps);
  const costsByStep: CostSummary = {};
  const leadId = String(lead.id);

  // Local working copy so dependents scheduled later in this same pass see
  // the column data and step_status written by steps that just ran, without
  // a round trip back through persistence.
  const workingLead: LeadRow = {
    ...lead,
    step_status: { ...(lead.step_status ?? {}) },
  };

  for (const step of ordered) {
    const stepStatus = (workingLead.step_status ?? {}) as Record<string, { state: StepState }>;
    const currentState = stepStatus[step.name]?.state;
    const isForced = options.force === step.name;

    if (currentState === "done" && !isForced) {
      continue;
    }

    if (!isSatisfied(step, stepStatus)) {
      const blockers = step.dependsOn.filter((dep) => {
        const s = stepStatus[dep]?.state;
        return s !== "done" && s !== "skipped";
      });
      const reason = `blocked: dependency "${blockers.join('", "')}" not done or skipped`;
      // "blocked", not "skipped": a skip satisfies dependents (graceful
      // degradation), but a block must cascade, or grandchildren would run
      // against missing data and freeze degraded output as "done". A blocked
      // step is re-attempted on the next pass, once the errored dependency's
      // retry has had its chance.
      await persistence.markStep(leadId, step.name, { state: "blocked", error: reason });
      workingLead.step_status = {
        ...workingLead.step_status,
        [step.name]: { state: "blocked", at: nowIso(), error: reason },
      };
      continue;
    }

    try {
      const result = await runStepWithRetries(step, workingLead);

      if ("skipped" in result) {
        const hasCost = result.cost_usd !== undefined;
        const markEntry: MarkStepInput = { state: "skipped", error: result.skipped };
        if (hasCost) {
          markEntry.cost_usd = result.cost_usd;
          markEntry.provider = result.provider;
        }
        await persistence.markStep(leadId, step.name, markEntry);
        workingLead.step_status = {
          ...workingLead.step_status,
          [step.name]: {
            state: "skipped",
            at: nowIso(),
            error: result.skipped,
            ...(hasCost ? { cost_usd: result.cost_usd, provider: result.provider } : {}),
          },
        };
        if (hasCost) {
          costsByStep[step.name] = (costsByStep[step.name] ?? 0) + (result.cost_usd ?? 0);
        }
        continue;
      }

      await persistence.writeColumn(leadId, step.column, result.data);
      await persistence.markStep(leadId, step.name, {
        state: "done",
        cost_usd: result.cost_usd,
        provider: result.provider,
      });
      workingLead[step.column] = result.data;
      workingLead.step_status = {
        ...workingLead.step_status,
        [step.name]: {
          state: "done",
          at: nowIso(),
          cost_usd: result.cost_usd,
          provider: result.provider,
        },
      };
      costsByStep[step.name] = (costsByStep[step.name] ?? 0) + result.cost_usd;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await persistence.markStep(leadId, step.name, { state: "error", error: message });
      workingLead.step_status = {
        ...workingLead.step_status,
        [step.name]: { state: "error", at: nowIso(), error: message },
      };
      // A row never crashes the batch: continue with the remaining steps.
    }
  }

  return costsByStep;
}

function mergeCostSummaries(target: CostSummary, source: CostSummary): void {
  for (const [step, cost] of Object.entries(source)) {
    target[step] = (target[step] ?? 0) + cost;
  }
}

/**
 * Runs the DAG across many lead rows with `options.concurrency` (default 5)
 * rows in flight, then prints and returns the per-step cost summary.
 */
export async function runBatch(
  leads: LeadRow[],
  steps: StepModule[],
  persistence: Persistence,
  options: RunOptions = {}
): Promise<CostSummary> {
  const concurrency = Math.max(1, options.concurrency ?? 5);
  const totalCosts: CostSummary = {};
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      const lead = leads[index];
      if (!lead) return;
      const costs = await runStepsForLead(lead, steps, persistence, options);
      mergeCostSummaries(totalCosts, costs);
    }
  }

  const workerCount = Math.min(concurrency, leads.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  printCostSummary(totalCosts);
  return totalCosts;
}

export function printCostSummary(costsByStep: CostSummary): void {
  console.log("\nPer-step cost summary:");
  const stepNames = Object.keys(costsByStep).sort();

  if (stepNames.length === 0) {
    console.log("  (no billable steps completed)");
    return;
  }

  let total = 0;
  for (const name of stepNames) {
    const cost = costsByStep[name] ?? 0;
    total += cost;
    console.log(`  ${name.padEnd(20)} $${cost.toFixed(4)}`);
  }
  console.log(`  ${"TOTAL".padEnd(20)} $${total.toFixed(4)}`);
}
