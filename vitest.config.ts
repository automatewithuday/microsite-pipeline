import { defineConfig } from "vitest/config";

// Exclude nested git worktrees (.worktrees/<branch>/ is a full repo copy)
// from the root test run, so `vitest run` does not double-collect the same
// test files when a worktree is checked out.
export default defineConfig({
  test: {
    // Pin the switches to the combination that requires no keys, so the suite
    // runs with zero secrets (CLI LLM path). Tests exercise pure logic and
    // mocked providers, never real API calls, so this only prevents db.ts's
    // import-time fail-fast from tripping in CI. A dummy DEEPLINE_API_KEY
    // lets the provider-keyed step tests past their missing-key skip guard so
    // they exercise the mocked provider path.
    env: { LLM_PROVIDER: "claude_cli", DEEPLINE_API_KEY: "test-key" },
    exclude: ["**/node_modules/**", "**/dist/**", ".worktrees/**"],
  },
});
