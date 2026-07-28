import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import { extractCostUsd, extractResultText, runClaude } from "./claudeCli.js";

// execFile's node-style callback: (err, stdout, stderr) => void.
function mockExecFileOnce(stdout: string) {
  execFileMock.mockImplementationOnce((_bin, _args, _opts, cb) => {
    cb(null, stdout, "");
  });
}

function mockExecFileError(message: string, stderr = "") {
  execFileMock.mockImplementationOnce((_bin, _args, _opts, cb) => {
    cb(new Error(message), "", stderr);
  });
}

describe("extractResultText", () => {
  it("reads a top-level result string", () => {
    expect(extractResultText({ result: "hello" })).toBe("hello");
  });

  it("falls back through candidate field names", () => {
    expect(extractResultText({ response: "hi" })).toBe("hi");
    expect(extractResultText({ output: "hi" })).toBe("hi");
    expect(extractResultText({ text: "hi" })).toBe("hi");
    expect(extractResultText({ content: "hi" })).toBe("hi");
  });

  it("reads a message.content[].text array shape", () => {
    expect(extractResultText({ message: { content: [{ type: "text", text: "hi there" }] } })).toBe(
      "hi there"
    );
  });

  it("returns null when nothing recognizable is present", () => {
    expect(extractResultText({ status: "ok" })).toBe(null);
  });

  it("returns null for a non-object, non-string value", () => {
    expect(extractResultText(42)).toBe(null);
  });

  it("passes through a bare string envelope", () => {
    expect(extractResultText("just text")).toBe("just text");
  });
});

describe("extractCostUsd", () => {
  it("reads a top-level total_cost_usd", () => {
    expect(extractCostUsd({ total_cost_usd: 0.02 })).toBe(0.02);
  });

  it("reads a nested usage.cost_usd", () => {
    expect(extractCostUsd({ usage: { cost_usd: 0.01 } })).toBe(0.01);
  });

  it("returns null when no cost field is present", () => {
    expect(extractCostUsd({ result: "hi" })).toBe(null);
  });
});

describe("runClaude", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("invokes the claude binary with -p, --output-format json, and --model", async () => {
    mockExecFileOnce(JSON.stringify({ result: '{"tamEstimation": 4200}' }));
    await runClaude("prompt text", { model: "claude-haiku-4-5", timeoutMs: 5000 });

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [bin, args] = execFileMock.mock.calls[0] as [string, string[], unknown, unknown];
    expect(bin).toMatch(/claude/);
    expect(args).toEqual(["-p", "prompt text", "--output-format", "json", "--model", "claude-haiku-4-5"]);
  });

  it("returns the extracted text, raw stdout, and cost", async () => {
    mockExecFileOnce(JSON.stringify({ result: "the answer", total_cost_usd: 0.03 }));
    const result = await runClaude("prompt", { model: "claude-sonnet-4-6", timeoutMs: 5000 });

    expect(result.text).toBe("the answer");
    expect(result.cost_usd).toBe(0.03);
    expect(result.raw).toBe(JSON.stringify({ result: "the answer", total_cost_usd: 0.03 }));
  });

  it("returns cost_usd null when the envelope has no cost field", async () => {
    mockExecFileOnce(JSON.stringify({ result: "the answer" }));
    const result = await runClaude("prompt", { model: "claude-sonnet-4-6", timeoutMs: 5000 });
    expect(result.cost_usd).toBe(null);
  });

  it("throws when stdout is not valid JSON", async () => {
    mockExecFileOnce("not json at all");
    await expect(runClaude("prompt", { model: "m", timeoutMs: 5000 })).rejects.toThrow(/non-JSON stdout/);
  });

  it("throws when the JSON envelope has no recognizable text field", async () => {
    mockExecFileOnce(JSON.stringify({ status: "ok" }));
    await expect(runClaude("prompt", { model: "m", timeoutMs: 5000 })).rejects.toThrow(
      /no recognizable result text field/
    );
  });

  it("throws a descriptive error when the CLI process itself fails", async () => {
    mockExecFileError("Command failed", "some stderr detail");
    await expect(runClaude("prompt", { model: "m", timeoutMs: 5000 })).rejects.toThrow(
      /claude CLI invocation failed.*some stderr detail/s
    );
  });
});
