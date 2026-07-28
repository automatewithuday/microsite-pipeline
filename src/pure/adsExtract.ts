// Extraction of one integer ad count per channel from Apify ad-library actor
// output. No I/O, no LLM calls.
//
// The count is prospect-facing: adSummary.ts embeds it verbatim ("You run a
// lot of Meta ads with N having been tested") and only mentions a channel when
// N >= 10. So the count must be TRUTHFUL for the company itself, never
// inflated by other advertisers. That drives the per-channel logic below.
//
// "Missing = 0": an empty or
// malformed dataset is not an error or a skip, it is a legitimate 0-ad
// result, so every extractor here always returns a number, never null.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Generic corporate/domain tokens that carry no identity, dropped before
// comparing an advertiser name to the company (so "Smartlead AI" matches
// "Smartlead" and "Cal.com" matches "Cal"). Kept small on purpose.
const NAME_STOPWORDS = new Set(["ai", "io", "com", "co", "inc", "llc", "ltd", "corp", "the", "app"]);

// Split a name into meaningful lowercase word tokens: "Resendez Immigration
// Law" -> ["resendez","immigration","law"], "Cal.com" -> ["cal"], "Warmly," ->
// ["warmly"]. Exact tokens (not substrings) so "resend" never matches
// "resendez".
function nameTokens(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !NAME_STOPWORDS.has(t));
}

function isSubset(a: string[], b: Set<string>): boolean {
  return a.length > 0 && a.every((t) => b.has(t));
}

// The advertiser name off one ad item, across actor shapes: the paginating
// ivanvs actor nests it in an `advertiser` object ({name,url}); older/simpler
// actors use a bare `advertiser_name` string or a string `advertiser`.
function advertiserName(item: Record<string, unknown>): unknown {
  const adv = item.advertiser;
  if (isRecord(adv) && typeof adv.name === "string") return adv.name;
  if (typeof adv === "string") return adv;
  return item.advertiser_name;
}

/**
 * LinkedIn Ad Library (ivanvs/linkedin-ad-library-scraper via an ?accountOwner=
 * search URL + `maxRecords`): paginates the Ad Library, one item per ad, with an
 * `advertiser` object {name,url}. The account-owner search is still fuzzy (live
 * 2026-07-27: ?accountOwner=Resend returned 42 ads from "Carlos Resende", none
 * of them Resend the company), so ownership is decided by advertiser name: count
 * only ads whose advertiser IS the company (bidirectional token-subset on exact
 * tokens, stopwords dropped, so "Smartlead AI" matches "Smartlead" but "resend"
 * never matches "resendez"). As with Meta/Google an undercount is safe, an
 * inflated foreign count is a lie; no company name, or none of whose ads appear,
 * returns 0. The count is bounded by the step's maxRecords cap: below the cap it
 * is the true total, at the cap it is a floor (heavy advertisers read "N+").
 */
export function extractLinkedInAdCount(items: unknown[], companyName: unknown): number {
  const target = nameTokens(companyName);
  if (target.length === 0) return 0;
  const targetSet = new Set(target);
  return items.filter((item) => {
    if (!isRecord(item)) return false;
    const adv = nameTokens(advertiserName(item));
    if (adv.length === 0) return false;
    return isSubset(target, new Set(adv)) || isSubset(adv, targetSet);
  }).length;
}

// Normalize a name to a comparable slug (lowercase, alphanumerics only) so
// "Smartlead AI" and "smartlead" collapse to a common "smartlead" stem.
function normName(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

// Pull a bare host out of a URL, a "https://x/y" caption, or a plain
// "Lusha.com" string. Returns "" when no domain-looking token is present.
function hostOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const m = value.trim().toLowerCase().match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/);
  return m?.[1] ?? "";
}

function metaPageId(item: unknown): string {
  if (!isRecord(item)) return "";
  const id = item.pageId ?? item.pageID;
  return typeof id === "string" ? id : typeof id === "number" ? String(id) : "";
}

function metaPageName(item: unknown): string {
  if (!isRecord(item)) return "";
  if (typeof item.pageName === "string") return item.pageName;
  const snapshot = item.snapshot;
  if (isRecord(snapshot)) {
    if (typeof snapshot.pageName === "string") return snapshot.pageName;
    if (typeof snapshot.page_name === "string") return snapshot.page_name;
  }
  return "";
}

// Every destination host an ad points at: the snapshot caption/linkUrl plus
// each carousel card's caption/linkUrl (Meta puts the landing domain in
// `caption`, e.g. "https://smartlead.ai/get_started" or "Lusha.com").
function adDestinationHosts(item: unknown): string[] {
  if (!isRecord(item)) return [];
  const snapshot = item.snapshot;
  if (!isRecord(snapshot)) return [];
  const out: string[] = [];
  const push = (v: unknown) => {
    const h = hostOf(v);
    if (h) out.push(h);
  };
  push(snapshot.caption);
  push(snapshot.linkUrl);
  if (Array.isArray(snapshot.cards)) {
    for (const card of snapshot.cards) {
      if (isRecord(card)) {
        push(card.caption);
        push(card.linkUrl);
      }
    }
  }
  return out;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith("." + domain);
}

/**
 * Meta Ad Library (apify/facebook-ads-scraper via a keyword-search URL): the
 * keyword search returns the company's own ads PLUS unrelated advertisers
 * whose ad text or name merely contains the query (live 2026-07-24: "smartlead"
 * returned 64 ads, only 33 from page "Smartlead AI"; "clay" returned 100 mostly
 * beauty/retail ads with names like "ClayCo"/"Clay Inn Hotel"). Meta ties ads
 * to a Page, so we identify the company's own Page(s) and count only those ads.
 *
 * Identification is by DESTINATION DOMAIN, not name: an ad belongs to the
 * company when it links to the company's domain (Smartlead's ads link to
 * smartlead.ai; ClayCo's do not link to clay.com). We collect the pageId of
 * every domain-matching ad, then count all ads from those pages (so a link-less
 * awareness ad on the same Page still counts). This deliberately returns 0
 * rather than guess when NO ad points at the domain: for the prospect-facing
 * summary an understated 0 is safe, an overstated false count is a lie.
 *
 * Name matching is only a fallback for when we have no company domain at all.
 */
export function extractMetaAdCount(items: unknown[], companyDomain: unknown, companyName: unknown): number {
  const domain = hostOf(companyDomain);
  if (domain) {
    const ownPageIds = new Set<string>();
    for (const item of items) {
      const pageId = metaPageId(item);
      if (!pageId) continue;
      if (adDestinationHosts(item).some((host) => hostMatches(host, domain))) {
        ownPageIds.add(pageId);
      }
    }
    return ownPageIds.size ? items.filter((item) => ownPageIds.has(metaPageId(item))).length : 0;
  }

  const target = normName(companyName);
  if (target.length < 4) return items.length;
  return items.filter((item) => {
    const page = normName(metaPageName(item));
    if (page.length < 4) return false;
    return page.includes(target) || target.includes(page);
  }).length;
}

/**
 * Google Ads Transparency (parseforge/google-ads-scraper via `domain`): the
 * actor returns one item per ad creative, already scoped to ads pointing at
 * the queried domain (mirrors Google's own "N ads" domain view). Google ties
 * ads to a domain, not to a name-matchable page (Smartlead's own ads run under
 * the founder's personal advertiser account), so we count every returned item
 * rather than name-filtering, which would wrongly zero out real ads.
 */
export function extractGoogleAdCount(items: unknown[]): number {
  return items.length;
}
