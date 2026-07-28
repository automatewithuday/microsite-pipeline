import { describe, expect, it } from "vitest";
import { extractGoogleAdCount, extractLinkedInAdCount, extractMetaAdCount } from "./adsExtract.js";

// The ivanvs/linkedin-ad-library-scraper actor paginates the Ad Library (input
// `urls` = an ?accountOwner= search URL, `maxRecords` = cap), returning one item
// per ad with an `advertiser` OBJECT {name,url}. The account-owner search is
// still fuzzy (live 2026-07-27: ?accountOwner=Resend returned 42 ads from
// "Carlos Resende", zero of them Resend), so count = only ads whose advertiser
// IS the company. Undercount is safe, an overstated foreign count is a lie
// (same rule as Meta/Google).
describe("extractLinkedInAdCount (filter to the company's own advertiser)", () => {
  const ad = (name: string | null) => ({ id: "x", advertiser: name === null ? null : { name } });

  it("counts a company's own ads (advertiser.name equals the company)", () => {
    const items = [ad("Cal.com"), ad("Cal.com"), ad("Cal.com")];
    expect(extractLinkedInAdCount(items, "Cal.com")).toBe(3);
  });

  it("ignores punctuation/case on the advertiser name (\"Warmly,\" == \"Warmly\")", () => {
    const items = [ad("Warmly,"), ad("Warmly,")];
    expect(extractLinkedInAdCount(items, "Warmly")).toBe(2);
  });

  it("returns 0 on a collision (Carlos Resende / Resendez are not Resend)", () => {
    const items = [ad(null), ad("Resendez Immigration Law"), ad("Carlos Resende")];
    expect(extractLinkedInAdCount(items, "Resend")).toBe(0);
  });

  it("counts only the company's ads in a mixed accountOwner page", () => {
    const items = [ad("Salesforce"), ad("Salesforce"), ad("Salesloft"), ad("Some Other Co")];
    expect(extractLinkedInAdCount(items, "Salesforce")).toBe(2);
  });

  it("matches a suffix variant advertiser name (\"Smartlead AI\" for \"Smartlead\")", () => {
    const items = [ad("Smartlead AI"), ad("Smartlead AI")];
    expect(extractLinkedInAdCount(items, "Smartlead")).toBe(2);
  });

  it("also reads a bare-string advertiser field (actor shape resilience)", () => {
    const items = [{ advertiser_name: "Cal.com" }, { advertiser: "Cal.com" }];
    expect(extractLinkedInAdCount(items, "Cal.com")).toBe(2);
  });

  it("missing/empty results = 0, not skipped or errored", () => {
    expect(extractLinkedInAdCount([], "Anyone")).toBe(0);
  });

  it("no company name = 0 (cannot verify ownership, so never overstate)", () => {
    expect(extractLinkedInAdCount([ad("Cal.com")], null)).toBe(0);
  });
});

describe("extractMetaAdCount (identify the company's Page by destination domain)", () => {
  // Two ads from Smartlead's page (one link-less), plus competitors whose ads
  // merely mention "smartlead" but link elsewhere.
  const items = [
    { pageId: "111", snapshot: { pageName: "Smartlead AI", caption: "https://smartlead.ai/get_started" } },
    { pageId: "111", snapshot: { pageName: "Smartlead AI", caption: undefined } },
    { pageId: "222", snapshot: { pageName: "Lusha", caption: "Lusha.com" } },
    { pageId: "333", snapshot: { pageName: "HeyReach", caption: "https://heyreach.io" } },
  ];

  it("counts all ads from the domain-matched page, including link-less ones", () => {
    expect(extractMetaAdCount(items, "smartlead.ai", "Smartlead")).toBe(2);
  });

  it("returns 0 when no ad links to the company domain (name collisions ignored)", () => {
    // "clay" keyword pulls ClayCo / Clay Inn Hotel, none linking to clay.com
    const clayNoise = [
      { pageId: "a", snapshot: { pageName: "ClayCo", caption: "clayco.com" } },
      { pageId: "b", snapshot: { pageName: "Desi Firangi by Clay Inn Hotel", caption: "clayinnhotel.in" } },
    ];
    expect(extractMetaAdCount(clayNoise, "clay.com", "Clay")).toBe(0);
  });

  it("matches a subdomain destination against the bare company domain", () => {
    const sub = [{ pageId: "x", snapshot: { caption: "https://get.smartlead.ai/trial" } }];
    expect(extractMetaAdCount(sub, "smartlead.ai", "Smartlead")).toBe(1);
  });

  it("reads a carousel card's caption for the destination domain", () => {
    const carousel = [{ pageId: "y", snapshot: { cards: [{ caption: "smartlead.ai" }] } }];
    expect(extractMetaAdCount(carousel, "smartlead.ai", "Smartlead")).toBe(1);
  });

  it("empty results = 0", () => {
    expect(extractMetaAdCount([], "smartlead.ai", "Smartlead")).toBe(0);
  });

  it("falls back to name matching only when no company domain is given", () => {
    const nameItems = [
      { pageName: "Smartlead AI" },
      { pageName: "Smartlead AI" },
      { pageName: "Lusha" },
    ];
    expect(extractMetaAdCount(nameItems, null, "Smartlead")).toBe(2);
  });
});

describe("extractGoogleAdCount (domain-scoped: one item per creative)", () => {
  it("counts returned creatives", () => {
    expect(extractGoogleAdCount([{ creativeId: "a" }, { creativeId: "b" }])).toBe(2);
  });

  it("missing/empty results = 0", () => {
    expect(extractGoogleAdCount([])).toBe(0);
  });
});
