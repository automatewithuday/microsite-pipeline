// Extracts a single JSON object out of an LLM text response that may wrap
// it in prose or a ```json fenced code block. No I/O, no LLM calls. Used by
// steps 10-12 before handing the parsed value to a zod schema (malformed
// output is a step error, not a partial write).

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1] ?? text;
}

/**
 * Finds the first balanced-brace `{...}` slice in `text`, scanning from the
 * first `{`. Returns null when there is no `{` or the braces never balance
 * (truncated output).
 */
function firstJsonObjectSlice(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parses the first JSON object found in `text`, stripping a ```/```json
 * code fence first if present. Throws (SyntaxError from JSON.parse, or a
 * plain Error when no `{` is found at all) on anything unparsable -- the
 * caller treats that as a step error, never a partial write.
 */
export function extractJsonObject(text: string): unknown {
  const unfenced = stripCodeFence(text);
  const slice = firstJsonObjectSlice(unfenced);
  if (slice === null) {
    throw new Error("extractJsonObject: no JSON object found in text");
  }
  return JSON.parse(slice);
}
