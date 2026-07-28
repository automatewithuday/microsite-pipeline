// Shared, module-level per-provider cooldown map. When a provider client
// (Deepline, Apify, Firecrawl) gets a 429, it calls setCooldown(provider,
// ms) here; every other step/row calling the same provider consults
// isCoolingDown/remainingCooldownMs before firing a request, so the back off
// applies across the whole process, not just to the row that hit the 429.
//
// Deliberately process-local (not persisted): a fresh process starts with a
// clean slate, which is fine, 429s recur immediately if the limit is still
// in effect.

const notBefore = new Map<string, number>();

export function setCooldown(provider: string, durationMs: number): void {
  notBefore.set(provider, Date.now() + durationMs);
}

export function remainingCooldownMs(provider: string): number {
  const until = notBefore.get(provider);
  if (!until) return 0;
  return Math.max(0, until - Date.now());
}

export function isCoolingDown(provider: string): boolean {
  return remainingCooldownMs(provider) > 0;
}

/**
 * Thrown by provider clients on an HTTP 429. Callers should call
 * setCooldown(provider, ms) before throwing this so subsequent calls (any
 * step, any row) back off too.
 */
export class RateLimitError extends Error {
  constructor(public readonly provider: string) {
    super(`${provider} rate limited (429)`);
    this.name = "RateLimitError";
  }
}

/** Test-only: clears all recorded cooldowns. */
export function _resetForTests(): void {
  notBefore.clear();
}
