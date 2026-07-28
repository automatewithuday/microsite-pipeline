import { describe, expect, it } from "vitest";
import { extractCostAndProvider, deeplineFoundResult, unwrapRaw } from "./deeplineMeta.js";

// Fixtures follow the real Deepline v2 execution envelope, confirmed from the
// published deepline npm CLI source and live calls:
// { status, toolResponse: { raw }, billing?, _metadata? }. Billing field-name
// candidates cover the shapes seen in the CLI/SDK; the extractor degrades to
// the caller-supplied fallback provider and cost 0 when nothing matches.

describe("extractCostAndProvider", () => {
  it("reads billing.credits at $0.10/credit with the fallback provider", () => {
    const envelope = { status: "completed", billing: { credits: 0.55 }, toolResponse: { raw: {} } };
    expect(extractCostAndProvider(envelope, "prospeo")).toEqual({
      cost_usd: 0.055,
      provider: "prospeo",
    });
  });

  it("prefers an explicit billing usd amount over credits", () => {
    const envelope = {
      status: "completed",
      billing: { credits: 0.98, usd: 0.098 },
      toolResponse: { raw: {} },
    };
    expect(extractCostAndProvider(envelope, "deepline_native")).toEqual({
      cost_usd: 0.098,
      provider: "deepline_native",
    });
  });

  it("recognizes credits_charged and total_credits aliases", () => {
    expect(extractCostAndProvider({ billing: { credits_charged: 2 } }, "deepline")).toEqual({
      cost_usd: 0.2,
      provider: "deepline",
    });
    expect(extractCostAndProvider({ billing: { total_credits: 1 } }, "deepline")).toEqual({
      cost_usd: 0.1,
      provider: "deepline",
    });
  });

  it("uses billing.provider when present", () => {
    const envelope = { billing: { credits: 1, provider: "prospeo" } };
    expect(extractCostAndProvider(envelope, "deepline")).toEqual({
      cost_usd: 0.1,
      provider: "prospeo",
    });
  });

  it("falls back to cost 0 and the fallback provider when billing is absent", () => {
    expect(extractCostAndProvider({ status: "completed" }, "prospeo")).toEqual({
      cost_usd: 0,
      provider: "prospeo",
    });
  });

  it("falls back safely for a non-object envelope", () => {
    expect(extractCostAndProvider(null, "deepline")).toEqual({ cost_usd: 0, provider: "deepline" });
  });
});

describe("deeplineFoundResult", () => {
  it("is true for a completed envelope with raw data", () => {
    const envelope = {
      status: "completed",
      toolResponse: { raw: { person: { full_name: "Jane Doe" } } },
    };
    expect(deeplineFoundResult(envelope)).toBe(true);
  });

  it("is false for status no_result", () => {
    expect(deeplineFoundResult({ status: "no_result", toolResponse: { raw: null } })).toBe(false);
  });

  it("is false for status failed", () => {
    expect(deeplineFoundResult({ status: "failed", toolResponse: { raw: {} } })).toBe(false);
  });

  it("is false for status error", () => {
    expect(deeplineFoundResult({ status: "error", toolResponse: { raw: {} } })).toBe(false);
  });

  it("is false when raw is null even on a completed status", () => {
    expect(deeplineFoundResult({ status: "completed", toolResponse: { raw: null } })).toBe(false);
  });

  it("is false when raw is an empty object", () => {
    expect(deeplineFoundResult({ status: "completed", toolResponse: { raw: {} } })).toBe(false);
  });

  it("is false when the provider raw carries error: true (Prospeo convention)", () => {
    const envelope = { status: "completed", toolResponse: { raw: { error: true } } };
    expect(deeplineFoundResult(envelope)).toBe(false);
  });

  it("is true when the provider raw carries error: false plus data", () => {
    const envelope = {
      status: "completed",
      toolResponse: { raw: { error: false, person: { full_name: "Jane Doe" } } },
    };
    expect(deeplineFoundResult(envelope)).toBe(true);
  });

  it("is false for null or non-object envelopes", () => {
    expect(deeplineFoundResult(null)).toBe(false);
    expect(deeplineFoundResult("nope")).toBe(false);
  });
});

describe("unwrapRaw", () => {
  it("returns toolResponse.raw when present", () => {
    const envelope = { toolResponse: { raw: { founders: [] } } };
    expect(unwrapRaw(envelope)).toEqual({ founders: [] });
  });

  it("returns null when the envelope has no toolResponse.raw", () => {
    expect(unwrapRaw({})).toBeNull();
    expect(unwrapRaw(null)).toBeNull();
  });
});
