// Deterministic formulas replacing the former Clay formula columns.
// No I/O, no LLM calls.

const fmt = (n: number): string => n.toLocaleString("en-US");
const round1000 = (n: number): number => Math.round(n / 1000) * 1000;

// Title-case each word of a name so an all-lowercase first name from enrichment
// ("maximus") does not render lowercased in prospect-facing copy.
const titleCase = (name: string): string =>
  name.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export const qualified = (employees: number, industry: string | null | undefined) =>
  employees >= 11 && employees <= 200 && /software/i.test(industry ?? "");

// Numbers are shown EXACT (not rounded) so a metric reads identically here and
// on the signals page, which cites the same figure verbatim.
export const paidSearchPct = (total: number, paid: number) =>
  total ? `Around ${fmt(total)} monthly visits, ${Math.round(
    (paid / total) * 100)}% coming from paid` : null;

export const liFollowersInsight = (name: string, n: number) =>
  n > 10000
    ? `${titleCase(name)} has ${fmt(n)} LinkedIn followers, so LinkedIn social is probably a significant channel.`
    : `${titleCase(name)} has ${fmt(n)} LinkedIn followers so LinkedIn social could probably become a bigger channel.`;

export const sdrInsight = (n: number) =>
  n >= 3 ? `With a SDR team of ${n}, outbound must be a relatively significant channel.`
  : n >= 1 ? `With a SDR team of ${n}, the outbound motion could have some room to grow.`
  : `With no SDRs/BDRs, the outbound motion has a lot of room for development.`;

export const adjustedTam  = (t: number) => round1000(t * 0.9);
export const adjustedTam2 = (t: number) => round1000(t * 0.6);
