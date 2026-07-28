import { describe, expect, it } from "vitest";
import { renderEnv } from "./envTemplate.js";

describe("renderEnv", () => {
  it("fills a value into an empty assignment", () => {
    const out = renderEnv("ANTHROPIC_API_KEY=\n", { ANTHROPIC_API_KEY: "sk-test" });
    expect(out).toBe("ANTHROPIC_API_KEY=sk-test\n");
  });

  it("replaces an existing value rather than appending a duplicate", () => {
    const out = renderEnv("LLM_PROVIDER=api\n", { LLM_PROVIDER: "claude_cli" });
    expect(out).toBe("LLM_PROVIDER=claude_cli\n");
    expect(out.match(/LLM_PROVIDER=/g)).toHaveLength(1);
  });

  it("keeps comment banners and blank lines untouched", () => {
    const template = ["# ====", "# Core", "# ====", "", "LLM_PROVIDER=api"].join("\n");
    const out = renderEnv(template, { LLM_PROVIDER: "api" });
    expect(out).toBe(template);
  });

  it("drops the trailing hint once a real value is set, so secrets stand alone", () => {
    const out = renderEnv("ANTHROPIC_API_KEY=           # https://console.anthropic.com\n", {
      ANTHROPIC_API_KEY: "sk-test",
    });
    expect(out).toBe("ANTHROPIC_API_KEY=sk-test\n");
  });

  it("preserves the trailing hint when the value is left empty", () => {
    const template = "DEEPLINE_API_KEY=            # https://code.deepline.com\n";
    const out = renderEnv(template, { DEEPLINE_API_KEY: "" });
    expect(out).toContain("# https://code.deepline.com");
    expect(out).toMatch(/^DEEPLINE_API_KEY=\s+#/);
  });

  it("uncomments a commented-out setting when a value is supplied", () => {
    const out = renderEnv("# OUTPUT_DIR=output\n", { OUTPUT_DIR: "decks" });
    expect(out).toBe("OUTPUT_DIR=decks\n");
  });

  it("leaves commented-out settings alone when no value is supplied", () => {
    const template = "# OUTPUT_DIR=output\n# LOCAL_DB_PATH=local.db\n";
    expect(renderEnv(template, {})).toBe(template);
  });

  it("appends keys the template never mentioned, under a label", () => {
    const out = renderEnv("LLM_PROVIDER=api\n", {
      LLM_PROVIDER: "api",
      EXTRA_URL: "https://example.com",
    });
    expect(out).toContain("# Added by scripts/setup.ts");
    expect(out).toContain("EXTRA_URL=https://example.com");
  });

  it("does not append empty extras", () => {
    const out = renderEnv("LLM_PROVIDER=api\n", { LLM_PROVIDER: "api", UNUSED_KEY: "" });
    expect(out).not.toContain("UNUSED_KEY");
    expect(out).not.toContain("# Added by scripts/setup.ts");
  });

  it("does not mistake a '#' inside a value for a trailing comment", () => {
    const out = renderEnv("BRAND_COLOR=#ffffff\n", { OTHER: "x" });
    expect(out).toContain("BRAND_COLOR=#ffffff");
  });

  it("leaves keys it was given no value for exactly as they were", () => {
    const template = "ANTHROPIC_API_KEY=\nAPIFY_TOKEN=existing\n";
    const out = renderEnv(template, { ANTHROPIC_API_KEY: "sk-test" });
    expect(out).toContain("APIFY_TOKEN=existing");
  });

  it("writes an empty value for a skipped key so the step skips cleanly", () => {
    const out = renderEnv("DEEPLINE_API_KEY=\n", { DEEPLINE_API_KEY: "" });
    expect(out).toBe("DEEPLINE_API_KEY=\n");
  });

  it("preserves indentation", () => {
    const out = renderEnv("  LLM_PROVIDER=api\n", { LLM_PROVIDER: "claude_cli" });
    expect(out).toBe("  LLM_PROVIDER=claude_cli\n");
  });

  it("round-trips the real .env.example shape without losing documentation", () => {
    const template = [
      "# =====================",
      "# Core",
      "# =====================",
      "LLM_PROVIDER=api             # api | claude_cli",
      "",
      "ANTHROPIC_API_KEY=           # https://console.anthropic.com/settings/keys",
      "DEEPLINE_API_KEY=            # https://code.deepline.com",
    ].join("\n");

    const out = renderEnv(template, {
      LLM_PROVIDER: "api",
      ANTHROPIC_API_KEY: "sk-ant-test",
      DEEPLINE_API_KEY: "",
    });

    // The secret is set and stands alone.
    expect(out).toContain("ANTHROPIC_API_KEY=sk-ant-test");
    // The skipped key keeps its documentation.
    expect(out).toContain("DEEPLINE_API_KEY=            # https://code.deepline.com");
    // Banners survive.
    expect(out).toContain("# Core");
    // No key is duplicated.
    expect(out.match(/^LLM_PROVIDER=/gm)).toHaveLength(1);
  });
});
