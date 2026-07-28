// Regression coverage for the needsFallback aliasing bug:
// unwrapCompanyResult returns Deepline's real field
// names (employees_count, not employee_count), but needsFallback used to
// check the aliased name directly, which is always undefined before
// aliasCompanyFields runs. That fired the paid Apify fallback on every row,
// complete or not. No real network calls: both the Deepline provider and
// apify-client are mocked with fixtures.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadRow } from "../db.js";

const { enrichCompanyMock, apifyCallMock, apifyListItemsMock, ApifyClientMock } = vi.hoisted(() => {
  const apifyCallMock = vi.fn();
  const apifyListItemsMock = vi.fn();
  return {
    enrichCompanyMock: vi.fn(),
    apifyCallMock,
    apifyListItemsMock,
    ApifyClientMock: vi.fn().mockImplementation(() => ({
      actor: () => ({ call: apifyCallMock }),
      dataset: () => ({ listItems: apifyListItemsMock }),
    })),
  };
});

vi.mock("../providers/deepline.js", () => ({
  enrichCompany: (...args: unknown[]) => enrichCompanyMock(...args),
}));

vi.mock("apify-client", () => ({
  ApifyClient: ApifyClientMock,
}));

// This repo's real .env leaves APIFY_ACTOR_LI_COMPANY blank (a comment-only
// placeholder line), which would make the fallback path unreachable
// regardless of the aliasing bug. Fix the actor id so the fallback-firing
// test actually exercises the branch the fix protects. apify-client itself
// is still fully mocked above, so this never makes a real Apify call.
vi.mock("../db.js", () => ({
  APIFY_ACTOR_LI_COMPANY: "test-li-company-actor",
  APIFY_TOKEN: "test-apify-token",
  DEEPLINE_API_KEY: "test-deepline-key",
}));

import step from "./02_enrichCompany.js";

function makeLead(personEnvelope: unknown, company?: string): LeadRow {
  return { id: "lead-1", step_status: {}, person: personEnvelope, company };
}

// Prospeo-shaped person envelope carrying the employer company record, per
// extractEmployerCompany's documented candidate locations.
const employerEnvelope = {
  toolResponse: {
    raw: {
      company: {
        name: "Acme Inc",
        domain: "acme.com",
        website: "acme.com",
        linkedin_url: "https://www.linkedin.com/company/acme",
      },
    },
  },
};

function completeDeeplineEnvelope() {
  return {
    status: "completed",
    billing: { credits_charged: 0.98 },
    toolResponse: {
      raw: {
        output: {
          company: {
            name: "Acme Inc",
            employees_count: 120,
            description: "A widget company.",
            linkedin_url: "https://www.linkedin.com/company/acme",
            website: "acme.com",
          },
        },
      },
    },
  };
}

function incompleteDeeplineEnvelope() {
  return {
    status: "completed",
    billing: { credits_charged: 0.98 },
    toolResponse: {
      raw: {
        output: {
          company: {
            name: "Acme Inc",
            linkedin_url: "https://www.linkedin.com/company/acme",
            website: "acme.com",
            // employees_count and description are absent: a genuinely
            // incomplete Deepline result.
          },
        },
      },
    },
  };
}

describe("step 02 enrichCompany: needsFallback aliasing", () => {
  beforeEach(() => {
    enrichCompanyMock.mockReset();
    apifyCallMock.mockReset();
    apifyListItemsMock.mockReset();
    ApifyClientMock.mockClear();
    apifyCallMock.mockResolvedValue({ defaultDatasetId: "dataset-1" });
    apifyListItemsMock.mockResolvedValue({ items: [] });
  });

  it("does not request the paid Apify fallback for a complete real-shape Deepline result", async () => {
    enrichCompanyMock.mockResolvedValue(completeDeeplineEnvelope());

    const result = await step.run(makeLead(employerEnvelope));

    expect(ApifyClientMock).not.toHaveBeenCalled();
    expect(apifyCallMock).not.toHaveBeenCalled();

    if (!("data" in result)) throw new Error("expected a data result, got skipped");
    const data = result.data as Record<string, unknown>;
    expect(data.fallback_unavailable).toBeUndefined();

    const merged = data.merged as Record<string, unknown>;
    expect(merged.employee_count).toBe(120);
    expect(merged.description).toBe("A widget company.");
  });

  it("still requests the Apify fallback when the Deepline result is genuinely incomplete", async () => {
    enrichCompanyMock.mockResolvedValue(incompleteDeeplineEnvelope());
    apifyCallMock.mockResolvedValue({ defaultDatasetId: "dataset-1" });
    apifyListItemsMock.mockResolvedValue({
      items: [{ employees_count: 45, description: "Fallback description" }],
    });

    const result = await step.run(makeLead(employerEnvelope));

    expect(apifyCallMock).toHaveBeenCalledTimes(1);

    if (!("data" in result)) throw new Error("expected a data result, got skipped");
    const data = result.data as Record<string, unknown>;
    const merged = data.merged as Record<string, unknown>;
    expect(merged.employee_count).toBe(45);
    expect(merged.description).toBe("Fallback description");
  });

  it("enriches the seeded company domain, overriding the person payload's primary employer", async () => {
    // Person payload's employer is acme.com, but the lead was seeded to pitch
    // target.com. The seed domain must win (Decision 2026-07-23).
    enrichCompanyMock.mockResolvedValue(completeDeeplineEnvelope());

    await step.run(makeLead(employerEnvelope, "target.com"));

    expect(enrichCompanyMock).toHaveBeenCalledTimes(1);
    const input = enrichCompanyMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toEqual({ domain: "target.com" });
  });

  it("falls back to the person payload's employer when the seed company is a display name, not a domain", async () => {
    enrichCompanyMock.mockResolvedValue(completeDeeplineEnvelope());

    await step.run(makeLead(employerEnvelope, "Acme Inc"));

    const input = enrichCompanyMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toEqual({ domain: "acme.com" });
  });

  it("points the Apify fallback at the seeded company, never the person's different employer", async () => {
    // Seed=target.com wins for Deepline enrichment, but Deepline returns an
    // incomplete result for target. The fallback must scrape target's own
    // LinkedIn page (from Deepline's return), NOT the person employer's acme
    // page, or it would fill target's null headcount from the wrong company
    // and corrupt the ICP gate.
    enrichCompanyMock.mockResolvedValue({
      status: "completed",
      billing: { credits_charged: 0.98 },
      toolResponse: {
        raw: {
          output: {
            company: {
              name: "Target Co",
              linkedin_url: "https://www.linkedin.com/company/target",
              website: "target.com",
              // employees_count and description absent: incomplete.
            },
          },
        },
      },
    });
    apifyListItemsMock.mockResolvedValue({
      items: [{ employees_count: 137, description: "Target's real description" }],
    });

    const result = await step.run(makeLead(employerEnvelope, "target.com"));

    expect(apifyCallMock).toHaveBeenCalledTimes(1);
    expect(apifyCallMock.mock.calls[0]![0]).toEqual({
      url: "https://www.linkedin.com/company/target",
    });

    if (!("data" in result)) throw new Error("expected a data result, got skipped");
    const merged = (result.data as Record<string, unknown>).merged as Record<string, unknown>;
    expect(merged.employee_count).toBe(137);
  });

  it("marks the fallback unavailable when the seeded Deepline result has no LinkedIn URL, rather than scraping the employer's", async () => {
    enrichCompanyMock.mockResolvedValue({
      status: "completed",
      billing: { credits_charged: 0.98 },
      toolResponse: {
        raw: {
          output: {
            company: {
              name: "Target Co",
              website: "target.com",
              // no linkedin_url, no employees_count, no description.
            },
          },
        },
      },
    });

    const result = await step.run(makeLead(employerEnvelope, "target.com"));

    // Employer's acme LinkedIn page must NOT be scraped.
    expect(apifyCallMock).not.toHaveBeenCalled();

    if (!("data" in result)) throw new Error("expected a data result, got skipped");
    expect((result.data as Record<string, unknown>).fallback_unavailable).toBe(true);
  });
});
