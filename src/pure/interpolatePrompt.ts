// Simple {placeholder} interpolation for prompt templates (prompts/*.txt).
// No I/O, no LLM calls.

export function interpolatePrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value !== undefined ? value : match;
  });
}
