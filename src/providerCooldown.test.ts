import { afterEach, describe, expect, it, vi } from "vitest";
import { isCoolingDown, remainingCooldownMs, setCooldown, _resetForTests } from "./providerCooldown.js";

describe("providerCooldown", () => {
  afterEach(() => {
    _resetForTests();
    vi.useRealTimers();
  });

  it("is not cooling down for a provider that has never been rate limited", () => {
    expect(isCoolingDown("deepline")).toBe(false);
    expect(remainingCooldownMs("deepline")).toBe(0);
  });

  it("cools down for the given duration after setCooldown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    setCooldown("firecrawl", 5000);
    expect(isCoolingDown("firecrawl")).toBe(true);
    expect(remainingCooldownMs("firecrawl")).toBe(5000);

    vi.setSystemTime(4000);
    expect(isCoolingDown("firecrawl")).toBe(true);
    expect(remainingCooldownMs("firecrawl")).toBe(1000);

    vi.setSystemTime(5001);
    expect(isCoolingDown("firecrawl")).toBe(false);
    expect(remainingCooldownMs("firecrawl")).toBe(0);
  });

  it("tracks cooldowns per provider independently", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    setCooldown("deepline", 1000);
    expect(isCoolingDown("apify")).toBe(false);
    expect(isCoolingDown("deepline")).toBe(true);
  });
});
