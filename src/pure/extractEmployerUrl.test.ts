import { describe, expect, it } from "vitest";
import { extractEmployerCompany } from "./extractEmployerUrl.js";

// Fixture shape is the real prospeo_enrich_person execution envelope:
// the company record lives at toolResponse.raw.company
// with { company_id, name, website, domain, linkedin_url }. A fallback path at
// raw.person.company is also documented in the tool's extractor metadata.

describe("extractEmployerCompany", () => {
  it("reads the company record from toolResponse.raw.company", () => {
    const envelope = {
      status: "completed",
      toolResponse: {
        raw: {
          error: false,
          person: { full_name: "Jane Doe", current_job_title: "Founder" },
          company: {
            company_id: "c1",
            name: "Acme",
            website: "https://acme.com",
            domain: "acme.com",
            linkedin_url: "https://www.linkedin.com/company/acme",
          },
        },
      },
    };
    expect(extractEmployerCompany(envelope)).toEqual({
      name: "Acme",
      website: "https://acme.com",
      domain: "acme.com",
      linkedin_url: "https://www.linkedin.com/company/acme",
    });
  });

  it("falls back to raw.person.company (documented alternate path)", () => {
    const envelope = {
      toolResponse: {
        raw: {
          person: {
            full_name: "Jane Doe",
            company: { name: "Acme", domain: "acme.com" },
          },
        },
      },
    };
    expect(extractEmployerCompany(envelope)).toEqual({
      name: "Acme",
      website: null,
      domain: "acme.com",
      linkedin_url: null,
    });
  });

  it("returns nulls for missing fields on a partial company record", () => {
    const envelope = {
      toolResponse: { raw: { company: { name: "Acme" } } },
    };
    expect(extractEmployerCompany(envelope)).toEqual({
      name: "Acme",
      website: null,
      domain: null,
      linkedin_url: null,
    });
  });

  it("reads the Apollo shape: raw.person.organization", () => {
    const envelope = {
      status: "completed",
      toolResponse: {
        raw: {
          person: {
            name: "Jane Doe",
            organization: {
              name: "Acme",
              website_url: "https://acme.com",
              primary_domain: "acme.com",
              linkedin_url: "https://www.linkedin.com/company/acme",
            },
          },
        },
      },
    };
    expect(extractEmployerCompany(envelope)).toEqual({
      name: "Acme",
      website: "https://acme.com",
      domain: "acme.com",
      linkedin_url: "https://www.linkedin.com/company/acme",
    });
  });

  it("reads the enrich_contact shape: raw.output.person company fields", () => {
    const envelope = {
      toolResponse: {
        raw: {
          output: {
            person: {
              full_name: "Jane Doe",
              company_name: "Acme",
              company_domain: "acme.com",
              company_linkedin_url: "https://www.linkedin.com/company/acme",
            },
          },
        },
      },
    };
    expect(extractEmployerCompany(envelope)).toEqual({
      name: "Acme",
      website: null,
      domain: "acme.com",
      linkedin_url: "https://www.linkedin.com/company/acme",
    });
  });

  it("returns null when there is no company record at all", () => {
    expect(extractEmployerCompany({ toolResponse: { raw: { person: {} } } })).toBe(null);
  });

  it("returns null for null or non-object envelopes", () => {
    expect(extractEmployerCompany(null)).toBe(null);
    expect(extractEmployerCompany("not an object")).toBe(null);
  });

  it("returns null when the company record has no usable identifier", () => {
    const envelope = { toolResponse: { raw: { company: { company_id: "c1" } } } };
    expect(extractEmployerCompany(envelope)).toBe(null);
  });
});
