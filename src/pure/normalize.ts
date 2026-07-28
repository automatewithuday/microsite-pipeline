// Domain normalization used before any provider call and before storing a
// domain value: strip protocol, leading www, path/query/fragment, trailing
// slash, and lowercase. No I/O, no LLM calls.

export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withoutProtocol = trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  const hostAndPath = withoutProtocol.split(/[/?#]/, 1)[0] ?? "";
  const withoutWww = hostAndPath.replace(/^www\./i, "");
  const lowered = withoutWww.toLowerCase();

  return lowered || null;
}

/**
 * Makes a website value fetchable: Deepline's real company payload returns
 * website as a bare domain ("martechs.io"), which fetch() rejects as an
 * invalid URL. Prefixes https:// when no protocol is present.
 */
export function toHttpUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
