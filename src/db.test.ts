import { afterEach, describe, expect, it, vi } from "vitest";

// db.ts reads process.env at import time, so each test stubs the env and
// re-imports a fresh copy of the module.
async function freshDb(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./db.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("required-env handling", () => {
  it("importing db.ts with a missing required key does not throw (keyless scripts like serve/seed must load)", async () => {
    await expect(
      freshDb({ LLM_PROVIDER: "api", ANTHROPIC_API_KEY: "" })
    ).resolves.toBeDefined();
  });

  it("assertRequiredEnv throws naming the missing var, with a pointer to setup", async () => {
    const db = await freshDb({ LLM_PROVIDER: "api", ANTHROPIC_API_KEY: "" });
    expect(() => db.assertRequiredEnv()).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => db.assertRequiredEnv()).toThrow(/npm run setup/);
  });

  it("assertRequiredEnv passes when the chosen switches need no key", async () => {
    const db = await freshDb({ LLM_PROVIDER: "claude_cli", ANTHROPIC_API_KEY: "" });
    expect(() => db.assertRequiredEnv()).not.toThrow();
  });

  it("assertRequiredEnv requires the research key for a keyed research provider", async () => {
    const db = await freshDb({
      LLM_PROVIDER: "claude_cli",
      RESEARCH_PROVIDER: "perplexity",
      PERPLEXITY_API_KEY: "",
    });
    expect(() => db.assertRequiredEnv()).toThrow(/PERPLEXITY_API_KEY/);
  });
});
