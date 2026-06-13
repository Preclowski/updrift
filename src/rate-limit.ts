/**
 * In-memory sliding-window rate limiter, keyed by hashed IP + action.
 *
 * State lives in the worker isolate, costing zero KV/D1 operations — exactly
 * what we want on the free tier (KV allows ~1000 writes/day, so per-request
 * counters there are a non-starter). The trade-off: isolates are ephemeral and
 * per-PoP, so the limit is best-effort, not a global guarantee. That is fine —
 * its job is to keep one noisy client from burning the 100K req/day budget,
 * while Turnstile handles bots and D1's UNIQUE constraint handles dupes.
 */

const buckets = new Map<string, number[]>();
const MAX_KEYS = 10_000; // crude memory cap; evict everything if exceeded

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  if (buckets.size > MAX_KEYS) buckets.clear();
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
}
