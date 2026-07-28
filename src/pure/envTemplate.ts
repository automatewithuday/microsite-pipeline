// Fills values into a .env template (normally .env.example) while keeping the
// template's comments and links intact — a generated .env should stay as
// self-documenting as the example it came from.
//
// Rules:
//   - A KEY=... line whose KEY has a supplied value is rewritten in place.
//   - A commented-out "# KEY=..." line is uncommented when a value is supplied,
//     so optional settings can be switched on without hand-editing.
//   - Supplied keys absent from the template are appended in a labelled block.
//   - Empty values are written as "KEY=" (the step then skips cleanly), and the
//     documenting trailing comment is preserved so the file still explains
//     itself.
//   - Anything else — blank lines, comment banners, unrelated keys — is passed
//     through untouched.

// KEY=value, optionally indented and optionally commented out. The value runs
// to end of line; any trailing " # comment" is separated out below.
const ASSIGNMENT = /^(\s*)(#\s*)?([A-Z0-9_]+)=(.*)$/;

// A trailing comment must be preceded by whitespace, so a "#" inside a value
// (as in a hex color) is not mistaken for one.
const TRAILING_COMMENT = /\s+#\s.*$/;

export function renderEnv(template: string, values: Record<string, string>): string {
  const remaining: Record<string, string> = { ...values };

  const lines = template.split("\n").map((line) => {
    const match = ASSIGNMENT.exec(line);
    if (!match) return line;

    const [, indent = "", , key = "", rest = ""] = match;
    if (!(key in remaining)) return line;

    const value = remaining[key]!;
    delete remaining[key];

    // Keep the explanatory comment when the line is left empty; drop it once a
    // real value is present so secrets are never trailed by stale hints.
    const comment = value ? "" : (TRAILING_COMMENT.exec(rest)?.[0] ?? "");
    return `${indent}${key}=${value}${comment}`;
  });

  // Only non-empty extras are worth appending: an empty value that the template
  // never mentioned would just be noise.
  const extras = Object.entries(remaining).filter(([, value]) => value !== "");
  if (extras.length > 0) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push("# Added by scripts/setup.ts");
    for (const [key, value] of extras) lines.push(`${key}=${value}`);
  }

  return lines.join("\n");
}
