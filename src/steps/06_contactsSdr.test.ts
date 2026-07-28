import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const { executeToolMock } = vi.hoisted(() => ({ executeToolMock: vi.fn() }));

vi.mock("../providers/deepline.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
}));

import step from "./06_contactsSdr.js";

function makeLead(domain: string | null): LeadRow {
  return { id: "lead-1", step_status: {}, company_data: { merged: { domain } } };
}

describe("step 06 sdr", () => {
  beforeEach(() => {
    executeToolMock.mockReset();
  });

  it("skips when there is no company domain", async () => {
    const result = await step.run(makeLead(null));
    expect(result).toEqual({ skipped: "no company domain for SDR search" });
    expect(executeToolMock).not.toHaveBeenCalled();
  });

  it("filters on the SDR/BDR role titles (boolean OR query string, not an array) and current-role flag", async () => {
    executeToolMock.mockResolvedValue({
      status: "completed",
      billing: { credits_charged: 0 },
      toolResponse: { raw: { total_persons: 5 } },
    });
    await step.run(makeLead("acme.com"));
    expect(executeToolMock).toHaveBeenCalledWith(
      "forager_person_role_search_totals",
      expect.objectContaining({
        organization_domains: ["acme.com"],
        role_is_current: true,
        role_title: expect.stringMatching(/sdr/i),
      }),
      expect.any(Number)
    );
    const [, payload] = executeToolMock.mock.calls[0] ?? [];
    expect(typeof (payload as Record<string, unknown>).role_title).toBe("string");
  });

  it("extracts total_persons (the tool's real output field) and expects $0 cost from the free tool", async () => {
    executeToolMock.mockResolvedValue({
      status: "completed",
      billing: { credits_charged: 0 },
      toolResponse: { raw: { total_persons: 5, total_search_results: 5, total_organizations: 1 } },
    });
    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ peopleCount: 5 });
    expect(result.cost_usd).toBe(0);
  });

  it("marks done with peopleCount null and a crustdata_pending fallback note when the tool throws (gated/errored), not a step error", async () => {
    executeToolMock.mockRejectedValue(new Error("403 tool not enabled for this account"));
    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data, not skipped or a thrown error");
    expect(result.data).toMatchObject({ peopleCount: null, fallback: "crustdata_pending" });
    expect(result.cost_usd).toBe(0);
  });

  it("marks peopleCount null with the fallback note when the tool returns an unparseable payload", async () => {
    executeToolMock.mockResolvedValue({
      status: "completed",
      billing: { credits_charged: 0 },
      toolResponse: { raw: {} },
    });
    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ peopleCount: null, fallback: "crustdata_pending" });
  });
});
