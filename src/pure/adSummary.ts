// Deterministic ad channel summary, replaces the former GPT-4.1 Mini column.
// No I/O, no LLM calls. Phrasing mirrors the battle-tested
// Clay "Ad Channel Summary" prompt: only channels with 10+ ads are mentioned,
// most active first, the lead clause says "<Channel> ads with N having been
// tested", follow clauses say "Also quite a lot on <Channel>, with N ads
// having been run", and all-below-threshold returns the exact sentinel.

export function adSummary(meta = 0, linkedin = 0, google = 0): string {
  const chans = [["Meta", meta], ["LinkedIn", linkedin], ["Google", google]]
    .filter(([, n]) => (n as number) >= 10)
    .sort((a, b) => (b[1] as number) - (a[1] as number)) as [string, number][];
  if (!chans.length) return "No significant ad activity detected.";
  const [top, ...rest] = chans as [[string, number], ...[string, number][]];
  let out = `You run a lot of ${top[0]} ads with ${top[1]} having been tested.`;
  for (const [name, n] of rest) out += ` Also quite a lot on ${name}, with ${n} ads having been run.`;
  return out;
}
