import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./extractJson.js";

describe("extractJsonObject", () => {
  it("parses a bare JSON object", () => {
    expect(extractJsonObject('{"tamEstimation": 4200}')).toEqual({ tamEstimation: 4200 });
  });

  it("strips a ```json fenced code block", () => {
    const text = 'Here you go:\n```json\n{"tamEstimation": 4200}\n```\nHope that helps.';
    expect(extractJsonObject(text)).toEqual({ tamEstimation: 4200 });
  });

  it("strips a plain ``` fence with no json tag", () => {
    const text = '```\n{"tamEstimation": 4200}\n```';
    expect(extractJsonObject(text)).toEqual({ tamEstimation: 4200 });
  });

  it("extracts the first balanced JSON object out of surrounding prose", () => {
    const text = 'Sure, based on the research the estimate is {"tamEstimation": 900} accounts.';
    expect(extractJsonObject(text)).toEqual({ tamEstimation: 900 });
  });

  it("handles nested objects when finding the balanced slice", () => {
    const text = 'result: {"segments": [{"segmentName": "Mid-market SaaS"}]} done';
    expect(extractJsonObject(text)).toEqual({ segments: [{ segmentName: "Mid-market SaaS" }] });
  });

  it("throws when there is no JSON object in the text", () => {
    expect(() => extractJsonObject("no json here at all")).toThrow(/no JSON object/);
  });

  it("throws (does not silently fall back) when braces never close", () => {
    expect(() => extractJsonObject('prose {"tamEstimation": 4200')).toThrow();
  });

  it("throws on malformed JSON inside a balanced slice", () => {
    expect(() => extractJsonObject("{tamEstimation: 4200}")).toThrow();
  });
});
