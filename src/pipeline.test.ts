import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runStepsForLead,
  runBatch,
  topoSort,
  isLeadPending,
  NonRetryableError,
  type Persistence,
  type StepModule,
  type StepResult,
} from "./pipeline.js";
import type { LeadRow } from "./db.js";

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return { id: "lead-1", step_status: {}, ...overrides };
}

class FakePersistence implements Persistence {
  columns: Record<string, unknown> = {};
  statusCalls: { leadId: string; step: string; entry: unknown }[] = [];
  columnCalls: { leadId: string; column: string; data: unknown }[] = [];

  async writeColumn(leadId: string, column: string, data: unknown): Promise<void> {
    this.columns[column] = data;
    this.columnCalls.push({ leadId, column, data });
  }

  async markStep(leadId: string, step: string, entry: unknown): Promise<void> {
    this.statusCalls.push({ leadId, step, entry });
  }

  stateFor(step: string): string | undefined {
    const calls = this.statusCalls.filter((c) => c.step === step);
    const last = calls[calls.length - 1];
    return (last?.entry as { state?: string } | undefined)?.state;
  }
}

function successStep(
  name: string,
  column: string,
  dependsOn: string[] = [],
  extra: Partial<StepModule> = {}
): StepModule {
  return {
    name,
    column,
    dependsOn,
    run: async (): Promise<StepResult> => ({
      data: { ok: true, from: name },
      cost_usd: 0.01,
      provider: "fake-provider",
    }),
    ...extra,
  };
}

describe("topoSort", () => {
  it("orders dependencies before dependents", () => {
    const a = successStep("a", "col_a");
    const b = successStep("b", "col_b", ["a"]);
    const c = successStep("c", "col_c", ["b"]);
    const ordered = topoSort([c, b, a]).map((s) => s.name);
    expect(ordered).toEqual(["a", "b", "c"]);
  });

  it("throws on an unknown dependency", () => {
    const a = successStep("a", "col_a", ["missing"]);
    expect(() => topoSort([a])).toThrow(/unknown step "missing"/);
  });

  it("throws on a circular dependency", () => {
    const a: StepModule = successStep("a", "col_a", ["b"]);
    const b: StepModule = successStep("b", "col_b", ["a"]);
    expect(() => topoSort([a, b])).toThrow(/circular dependency/);
  });
});

describe("runStepsForLead", () => {
  it("runs independent steps and writes column + done status", async () => {
    const persistence = new FakePersistence();
    const step = successStep("person", "person");

    const costs = await runStepsForLead(makeLead(), [step], persistence);

    expect(persistence.columns.person).toEqual({ ok: true, from: "person" });
    expect(persistence.stateFor("person")).toBe("done");
    expect(costs).toEqual({ person: 0.01 });
  });

  it("runs dependency order: a dependent step sees data written by its dependency in the same pass", async () => {
    const persistence = new FakePersistence();
    let seenPersonColumn: unknown;

    const person = successStep("person", "person");
    const company: StepModule = {
      name: "company",
      column: "company_data",
      dependsOn: ["person"],
      run: async (lead) => {
        seenPersonColumn = lead.person;
        return { data: { ok: true }, cost_usd: 0.02, provider: "fake" };
      },
    };

    await runStepsForLead(makeLead(), [company, person], persistence);

    expect(seenPersonColumn).toEqual({ ok: true, from: "person" });
    expect(persistence.stateFor("company")).toBe("done");
  });

  it("skips a step already marked done, unless forced", async () => {
    const persistence = new FakePersistence();
    let runCount = 0;
    const step: StepModule = {
      name: "person",
      column: "person",
      dependsOn: [],
      run: async () => {
        runCount++;
        return { data: {}, cost_usd: 0.01, provider: "fake" };
      },
    };
    const lead = makeLead({ step_status: { person: { state: "done", at: "2020-01-01" } } });

    await runStepsForLead(lead, [step], persistence);
    expect(runCount).toBe(0);
    expect(persistence.statusCalls).toHaveLength(0);

    await runStepsForLead(lead, [step], persistence, { force: "person" });
    expect(runCount).toBe(1);
    expect(persistence.stateFor("person")).toBe("done");
  });

  it("isolates a failing step: other independent steps still complete", async () => {
    vi.useFakeTimers();
    const persistence = new FakePersistence();
    const failing: StepModule = {
      name: "flaky",
      column: "flaky_col",
      dependsOn: [],
      run: async () => {
        throw new Error("boom");
      },
    };
    const healthy = successStep("healthy", "healthy_col");

    const promise = runStepsForLead(makeLead(), [failing, healthy], persistence);
    await vi.advanceTimersByTimeAsync(15_000); // exhaust flaky's 2s+8s backoff
    const costs = await promise;

    expect(persistence.stateFor("flaky")).toBe("error");
    expect(persistence.stateFor("healthy")).toBe("done");
    expect(costs).toEqual({ healthy: 0.01 });

    vi.useRealTimers();
  });

  it("propagates a skipped dependency: a dependent step is attempted and marks itself skipped", async () => {
    const persistence = new FakePersistence();
    const upstream: StepModule = {
      name: "company",
      column: "company_data",
      dependsOn: [],
      run: async () => ({ skipped: "no website" }),
    };
    let dependentRan = false;
    const dependent: StepModule = {
      name: "crm",
      column: "crm",
      dependsOn: ["company"],
      run: async (lead) => {
        dependentRan = true;
        if (!lead.company_data) return { skipped: "company data missing" };
        return { data: {}, cost_usd: 0, provider: "fake" };
      },
    };

    await runStepsForLead(makeLead(), [upstream, dependent], persistence);

    expect(persistence.stateFor("company")).toBe("skipped");
    expect(dependentRan).toBe(true);
    expect(persistence.stateFor("crm")).toBe("skipped");
  });

  it("blocks a step whose dependency errored, without calling its run function", async () => {
    vi.useFakeTimers();
    const persistence = new FakePersistence();
    const upstream: StepModule = {
      name: "company",
      column: "company_data",
      dependsOn: [],
      run: async () => {
        throw new Error("upstream boom");
      },
    };
    let dependentRan = false;
    const dependent: StepModule = {
      name: "crm",
      column: "crm",
      dependsOn: ["company"],
      run: async () => {
        dependentRan = true;
        return { data: {}, cost_usd: 0, provider: "fake" };
      },
    };

    const promise = runStepsForLead(makeLead(), [upstream, dependent], persistence);
    await vi.advanceTimersByTimeAsync(15_000); // exhaust company's 2s+8s backoff
    await promise;

    expect(persistence.stateFor("company")).toBe("error");
    expect(dependentRan).toBe(false);
    expect(persistence.stateFor("crm")).toBe("skipped");

    vi.useRealTimers();
  });

  it("marks a NonRetryableError as error immediately, without waiting out the retry backoff", async () => {
    let runCount = 0;
    const persistence = new FakePersistence();
    const step: StepModule = {
      name: "person",
      column: "person",
      dependsOn: [],
      run: async () => {
        runCount++;
        throw new NonRetryableError("no person found");
      },
    };

    const start = Date.now();
    await runStepsForLead(makeLead(), [step], persistence);
    const elapsed = Date.now() - start;

    expect(runCount).toBe(1); // no retries burned
    expect(elapsed).toBeLessThan(500); // did not wait out 2s/8s backoff
    expect(persistence.stateFor("person")).toBe("error");
  });

  it("respects a step's maxRetries: 1 (one retry, two attempts total)", async () => {
    vi.useFakeTimers();
    const persistence = new FakePersistence();
    let runCount = 0;
    const step: StepModule = {
      name: "capped",
      column: "capped_col",
      dependsOn: [],
      maxRetries: 1,
      run: async () => {
        runCount++;
        throw new Error("boom");
      },
    };

    const promise = runStepsForLead(makeLead(), [step], persistence);
    await vi.advanceTimersByTimeAsync(15_000); // exhaust the single 2s backoff entry
    await promise;

    expect(runCount).toBe(2); // 1 initial + 1 retry, not the default 3
    expect(persistence.stateFor("capped")).toBe("error");

    vi.useRealTimers();
  });

  it("defaults to 2 retries (three attempts total) when maxRetries is not set", async () => {
    vi.useFakeTimers();
    const persistence = new FakePersistence();
    let runCount = 0;
    const step: StepModule = {
      name: "default_retries",
      column: "default_retries_col",
      dependsOn: [],
      run: async () => {
        runCount++;
        throw new Error("boom");
      },
    };

    const promise = runStepsForLead(makeLead(), [step], persistence);
    await vi.advanceTimersByTimeAsync(15_000);
    await promise;

    expect(runCount).toBe(3);
    expect(persistence.stateFor("default_retries")).toBe("error");

    vi.useRealTimers();
  });

  it("times out a slow step and marks it error after exhausting retries", async () => {
    vi.useFakeTimers();
    const persistence = new FakePersistence();
    const slow: StepModule = {
      name: "slow",
      column: "slow_col",
      dependsOn: [],
      timeoutMs: 10,
      run: () => new Promise(() => {}), // never resolves
    };

    const promise = runStepsForLead(makeLead(), [slow], persistence);
    // 3 attempts total: timeout (10ms) then backoff (2000ms, 8000ms) between
    // attempts. Advance well past all of it.
    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    expect(persistence.stateFor("slow")).toBe("error");
    const entry = persistence.statusCalls.find((c) => c.step === "slow")?.entry as {
      error?: string;
    };
    expect(entry.error).toMatch(/timed out/);

    vi.useRealTimers();
  });

  it("records cost on a skipped result that carries cost_usd, and includes it in the cost summary", async () => {
    const persistence = new FakePersistence();
    const step: StepModule = {
      name: "founders",
      column: "founders",
      dependsOn: [],
      run: async () => ({ skipped: "no founders", cost_usd: 0.014, provider: "aviato" }),
    };

    const costs = await runStepsForLead(makeLead(), [step], persistence);

    expect(persistence.stateFor("founders")).toBe("skipped");
    const entry = persistence.statusCalls.find((c) => c.step === "founders")?.entry as {
      cost_usd?: number;
      provider?: string;
    };
    expect(entry.cost_usd).toBe(0.014);
    expect(entry.provider).toBe("aviato");
    expect(costs).toEqual({ founders: 0.014 });
  });

  it("a skip with no cost_usd behaves exactly as today (cost 0, not summed)", async () => {
    const persistence = new FakePersistence();
    const step: StepModule = {
      name: "traffic",
      column: "traffic",
      dependsOn: [],
      run: async () => ({ skipped: "no domain" }),
    };

    const costs = await runStepsForLead(makeLead(), [step], persistence);

    expect(persistence.stateFor("traffic")).toBe("skipped");
    const entry = persistence.statusCalls.find((c) => c.step === "traffic")?.entry as {
      cost_usd?: number;
    };
    expect(entry.cost_usd).toBeUndefined();
    expect(costs).toEqual({});
  });
});

describe("isLeadPending", () => {
  const steps = [successStep("a", "col_a"), successStep("b", "col_b", ["a"])];

  it("is true for a fresh lead with no step_status", () => {
    expect(isLeadPending(makeLead({ step_status: {} }), steps)).toBe(true);
  });

  it("is true when one step errored", () => {
    const lead = makeLead({
      step_status: {
        a: { state: "done", at: "t" },
        b: { state: "error", at: "t", error: "boom" },
      },
    });
    expect(isLeadPending(lead, steps)).toBe(true);
  });

  it("is false when every step is done or skipped", () => {
    const lead = makeLead({
      step_status: {
        a: { state: "done", at: "t" },
        b: { state: "skipped", at: "t", error: "n/a" },
      },
    });
    expect(isLeadPending(lead, steps)).toBe(false);
  });
});

describe("runBatch", () => {
  it("processes every lead and aggregates the cost summary across rows", async () => {
    const persistence = new FakePersistence();
    const step = successStep("person", "person");
    const leads = [makeLead({ id: "1" }), makeLead({ id: "2" }), makeLead({ id: "3" })];

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const costs = await runBatch(leads, [step], persistence, { concurrency: 2 });
    logSpy.mockRestore();

    expect(costs).toEqual({ person: 0.03 });
    expect(persistence.columnCalls).toHaveLength(3);
  });
});
