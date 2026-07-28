import { describe, expect, it } from "vitest";
import { aliasCompanyFields, mergeCompanyData } from "./companyMerge.js";

describe("mergeCompanyData", () => {
  it("prefers Deepline fields when both are present", () => {
    const deepline = { name: "Acme Inc", employee_count: 50, industry: "Software" };
    const apify = { name: "Acme Incorporated", employee_count: 55, industry: "Fintech" };
    expect(mergeCompanyData(deepline, apify)).toEqual({
      name: "Acme Inc",
      employee_count: 50,
      industry: "Software",
    });
  });

  it("fills nulls from Apify when Deepline is missing a field", () => {
    const deepline = { name: "Acme Inc", employee_count: null, description: null };
    const apify = { employee_count: 42, description: "A widget company" };
    expect(mergeCompanyData(deepline, apify)).toEqual({
      name: "Acme Inc",
      employee_count: 42,
      description: "A widget company",
    });
  });

  it("fills undefined Deepline fields from Apify", () => {
    const deepline = { name: "Acme Inc" };
    const apify = { website: "https://acme.com" };
    expect(mergeCompanyData(deepline, apify)).toEqual({
      name: "Acme Inc",
      website: "https://acme.com",
    });
  });

  it("leaves a field null when both sources are null or missing", () => {
    const deepline = { name: "Acme Inc", description: null };
    const apify = { description: null };
    expect(mergeCompanyData(deepline, apify)).toEqual({
      name: "Acme Inc",
      description: null,
    });
  });

  it("returns Deepline unchanged when apify is null (no fallback ran)", () => {
    const deepline = { name: "Acme Inc", employee_count: null };
    expect(mergeCompanyData(deepline, null)).toEqual({
      name: "Acme Inc",
      employee_count: null,
    });
  });
});

// Deepline's real enrich_company payload uses employees_count and
// linkedin_url; the canonical field names used downstream are employee_count
// and url. aliasCompanyFields adds the canonical names without touching the
// originals.
describe("aliasCompanyFields", () => {
  it("adds employee_count from employees_count and url from linkedin_url", () => {
    const fields = {
      name: "Acme",
      employees_count: 16,
      linkedin_url: "https://www.linkedin.com/company/acme/",
    };
    expect(aliasCompanyFields(fields)).toEqual({
      name: "Acme",
      employees_count: 16,
      linkedin_url: "https://www.linkedin.com/company/acme/",
      employee_count: 16,
      url: "https://www.linkedin.com/company/acme/",
    });
  });

  it("does not overwrite spec-named fields that already exist", () => {
    const fields = { employee_count: 20, employees_count: 16, url: "a", linkedin_url: "b" };
    expect(aliasCompanyFields(fields)).toEqual({
      employee_count: 20,
      employees_count: 16,
      url: "a",
      linkedin_url: "b",
    });
  });

  it("leaves fields absent when no source value exists", () => {
    expect(aliasCompanyFields({ name: "Acme" })).toEqual({ name: "Acme" });
  });

  it("does not mutate its input", () => {
    const fields = { employees_count: 16 };
    aliasCompanyFields(fields);
    expect(fields).toEqual({ employees_count: 16 });
  });
});
