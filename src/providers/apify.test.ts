import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callMock, listItemsMock, actorMock, datasetMock, runMock, runGetMock } = vi.hoisted(() => ({
  callMock: vi.fn(),
  listItemsMock: vi.fn(),
  actorMock: vi.fn(),
  datasetMock: vi.fn(),
  runMock: vi.fn(),
  runGetMock: vi.fn(),
}));

vi.mock("apify-client", () => ({
  ApifyClient: vi.fn().mockImplementation(() => ({
    actor: (...args: unknown[]) => {
      actorMock(...args);
      return { call: callMock };
    },
    dataset: (...args: unknown[]) => {
      datasetMock(...args);
      return { listItems: listItemsMock };
    },
    run: (...args: unknown[]) => {
      runMock(...args);
      return { get: runGetMock };
    },
  })),
}));

vi.mock("../db.js", () => ({
  APIFY_TOKEN: "test-token",
}));

import { runActor } from "./apify.js";

describe("runActor cost extraction", () => {
  beforeEach(() => {
    callMock.mockReset();
    listItemsMock.mockReset();
    runMock.mockReset();
    runGetMock.mockReset();
    listItemsMock.mockResolvedValue({ items: [{ a: 1 }] });
    // Default re-fetch returns no cost, so a test only recovers a cost if it
    // opts in by overriding runGetMock.
    runGetMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads usageTotalUsd inline and does not re-fetch when the cost is already set", async () => {
    callMock.mockResolvedValue({ id: "run-1", defaultDatasetId: "ds-1", usageTotalUsd: 0.42 });

    const result = await runActor("some-actor", {}, { timeoutMs: 1000 });

    expect(result.runCost_usd).toBe(0.42);
    expect(result.runId).toBe("run-1");
    expect(result.items).toEqual([{ a: 1 }]);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("falls back to summing the usageUsd breakdown when usageTotalUsd is absent", async () => {
    callMock.mockResolvedValue({
      id: "run-2",
      defaultDatasetId: "ds-2",
      usageUsd: { ACTOR_COMPUTE_UNITS: 0.03, DATASET_WRITES: 0.002 },
    });

    const result = await runActor("some-actor", {}, { timeoutMs: 1000 });

    expect(result.runCost_usd).toBeCloseTo(0.032, 5);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("re-fetches the settled run cost when usageTotalUsd is 0 inline then updates (the live pay-per-event lag)", async () => {
    vi.useFakeTimers();
    callMock.mockResolvedValue({ id: "run-6", defaultDatasetId: "ds-6", usageTotalUsd: 0 });
    runGetMock.mockResolvedValue({ id: "run-6", usageTotalUsd: 0.12 });

    const p = runActor("some-actor", {}, { timeoutMs: 1000 });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.runCost_usd).toBe(0.12);
    expect(runMock).toHaveBeenCalledWith("run-6");
  });

  it("returns null (never a fabricated 0) when neither usageTotalUsd nor usageUsd is ever present", async () => {
    vi.useFakeTimers();
    callMock.mockResolvedValue({ id: "run-3", defaultDatasetId: "ds-3" });
    runGetMock.mockResolvedValue({ id: "run-3" });

    const p = runActor("some-actor", {}, { timeoutMs: 1000 });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.runCost_usd).toBeNull();
  });

  it("returns null when usageUsd has no numeric entries, not a fabricated 0", async () => {
    vi.useFakeTimers();
    callMock.mockResolvedValue({ id: "run-4", defaultDatasetId: "ds-4", usageUsd: {} });
    runGetMock.mockResolvedValue({ id: "run-4", usageUsd: {} });

    const p = runActor("some-actor", {}, { timeoutMs: 1000 });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.runCost_usd).toBeNull();
  });

  it("prefers usageTotalUsd over usageUsd when both are present inline", async () => {
    callMock.mockResolvedValue({
      id: "run-5",
      defaultDatasetId: "ds-5",
      usageTotalUsd: 0.5,
      usageUsd: { ACTOR_COMPUTE_UNITS: 0.99 },
    });

    const result = await runActor("some-actor", {}, { timeoutMs: 1000 });

    expect(result.runCost_usd).toBe(0.5);
    expect(runMock).not.toHaveBeenCalled();
  });
});
