import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const { executeToolMock } = vi.hoisted(() => ({ executeToolMock: vi.fn() }));

vi.mock("../providers/deepline.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
}));

import step from "./06_contactsFounders.js";

function makeLead(domain: string | null, linkedinUrl: string | null = null): LeadRow {
  return { id: "lead-1", step_status: {}, company_data: { merged: { domain, url: linkedinUrl } } };
}

describe("step 06 founders", () => {
  beforeEach(() => {
    executeToolMock.mockReset();
  });

  it("skips when the company has neither a domain nor a LinkedIn URL", async () => {
    const result = await step.run(makeLead(null));
    expect(result).toEqual({ skipped: "no company domain or LinkedIn URL for founders search" });
    expect(executeToolMock).not.toHaveBeenCalled();
  });

  it("skips (not error) when the founders search finds nothing, with cost 0 when the mock has no billing", async () => {
    executeToolMock.mockResolvedValueOnce({ status: "no_result", toolResponse: { raw: { founders: [] } } });
    const result = await step.run(makeLead("acme.com"));
    expect(result).toEqual({ skipped: "no founders", cost_usd: 0, provider: "aviato" });
    expect(executeToolMock).toHaveBeenCalledTimes(1);
  });

  it("records the real paid-call cost on a confirmed no-founders miss, instead of letting it vanish", async () => {
    executeToolMock.mockResolvedValueOnce({
      status: "no_result",
      billing: { credits_charged: 0.14 },
      toolResponse: { raw: { founders: [] } },
    });
    const result = await step.run(makeLead("acme.com"));
    expect(result).toEqual({ skipped: "no founders", cost_usd: 0.014, provider: "aviato" });
    expect(executeToolMock).toHaveBeenCalledTimes(1);
  });

  it("prefers website and does NOT also send linkedinURL (a LinkedIn company URL 404s aviato)", async () => {
    executeToolMock.mockResolvedValueOnce({
      status: "completed",
      billing: { credits_charged: 0.14 },
      toolResponse: {
        raw: { founders: [{ firstName: "Jane", URLs: { linkedin: "linkedin.com/in/jane" } }] },
      },
    });
    executeToolMock.mockResolvedValueOnce({
      status: "completed",
      billing: { usd_amount: 0.02 },
      toolResponse: { raw: { linkedinFollowers: 5000 } },
    });

    await step.run(makeLead("acme.com", "https://www.linkedin.com/company/acme/"));

    expect(executeToolMock).toHaveBeenNthCalledWith(
      1,
      "aviato_get_company_founders",
      { page: 1, perPage: 10, website: "acme.com" },
      expect.any(Number)
    );
    expect(executeToolMock).toHaveBeenNthCalledWith(
      2,
      "aviato_person_enrich",
      { linkedinURL: "linkedin.com/in/jane" },
      expect.any(Number)
    );
  });

  it("falls back to linkedinURL only when there is no domain", async () => {
    executeToolMock.mockResolvedValueOnce({
      status: "completed",
      billing: { credits_charged: 0.14 },
      toolResponse: {
        raw: { founders: [{ firstName: "Jane", URLs: { linkedin: "linkedin.com/in/jane" } }] },
      },
    });
    executeToolMock.mockResolvedValueOnce({
      status: "completed",
      billing: { usd_amount: 0.02 },
      toolResponse: { raw: { linkedinFollowers: 5000 } },
    });

    await step.run(makeLead(null, "https://www.linkedin.com/company/acme/"));

    expect(executeToolMock).toHaveBeenNthCalledWith(
      1,
      "aviato_get_company_founders",
      { page: 1, perPage: 10, linkedinURL: "https://www.linkedin.com/company/acme/" },
      expect.any(Number)
    );
  });

  it("extracts first_name and num_followers when both calls hit", async () => {
    executeToolMock.mockResolvedValueOnce({
      status: "completed",
      billing: { credits_charged: 0.14 },
      toolResponse: {
        raw: { founders: [{ first_name: "Jane", URLs: { linkedin: "https://linkedin.com/in/jane" } }] },
      },
    });
    executeToolMock.mockResolvedValueOnce({
      status: "completed",
      billing: { usd_amount: 0.02 },
      toolResponse: { raw: { linkedinFollowers: 5000 } },
    });

    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ first_name: "Jane", num_followers: 5000 });
    expect(result.cost_usd).toBeCloseTo(0.014 + 0.02, 5);
    expect(executeToolMock).toHaveBeenCalledTimes(2);
  });

  it("keeps first_name with followers null when the enrich call misses", async () => {
    executeToolMock.mockResolvedValueOnce({
      status: "completed",
      billing: { credits_charged: 0.14 },
      toolResponse: {
        raw: { founders: [{ first_name: "Jane", URLs: { linkedin: "https://linkedin.com/in/jane" } }] },
      },
    });
    executeToolMock.mockResolvedValueOnce({ status: "no_result", toolResponse: { raw: {} } });

    const result = await step.run(makeLead("acme.com"));
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ first_name: "Jane", num_followers: null });
  });

  it("does not call person_enrich when the founder has no LinkedIn URL", async () => {
    executeToolMock.mockResolvedValueOnce({
      status: "completed",
      billing: { credits_charged: 0.14 },
      toolResponse: { raw: { founders: [{ first_name: "Jane" }] } },
    });

    const result = await step.run(makeLead("acme.com"));
    expect(executeToolMock).toHaveBeenCalledTimes(1);
    if (!("data" in result)) throw new Error("expected data");
    expect(result.data).toMatchObject({ first_name: "Jane", num_followers: null });
  });
});
