import { describe, expect, it, vi } from "vitest";
import type { LeadRow } from "./db.js";
import { applyDerived } from "./derivedRoutine.js";
import type { Persistence } from "./pipeline.js";

function fakePersistence(): Persistence & { writes: Array<{ column: string; data: unknown }> } {
  const writes: Array<{ column: string; data: unknown }> = [];
  return {
    writes,
    writeColumn: vi.fn(async (_leadId, column, data) => {
      writes.push({ column, data });
    }),
    markStep: vi.fn(async () => {}),
  };
}

describe("applyDerived", () => {
  it("writes both the qualified and derived columns", async () => {
    const lead: LeadRow = {
      id: "lead-1",
      step_status: {},
      company_data: { merged: { employee_count: 50, industry: "Software" } },
    };
    const persistence = fakePersistence();

    const result = await applyDerived(lead, persistence);

    expect(persistence.writes).toEqual([
      { column: "qualified", data: true },
      { column: "derived", data: result.derived },
    ]);
    expect(result.qualified).toBe(true);
  });

  it("uses the lead id (stringified) for both writes", async () => {
    const lead: LeadRow = { id: "abc-123", step_status: {} };
    const persistence = fakePersistence();
    await applyDerived(lead, persistence);

    expect(persistence.writeColumn).toHaveBeenNthCalledWith(1, "abc-123", "qualified", false);
    expect(persistence.writeColumn).toHaveBeenNthCalledWith(2, "abc-123", "derived", expect.any(Object));
  });
});
