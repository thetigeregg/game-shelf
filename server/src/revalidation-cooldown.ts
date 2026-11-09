/**
 * Limits stale-cache revalidations to one per cache key per cooldown window, whatever the outcome.
 *
 * A stale cache entry queues a revalidation on every read. Job deduplication only covers jobs that
 * are still pending or running, so once one finishes (succeeded, found no match, or failed after
 * its retries) the next read queued another: an entry the source no longer matches, or a source
 * that errors, kept a loop of requests going against the scraper. With the cooldown, each key is
 * revalidated at most once per window; the entry keeps being served until it expires.
 *
 * In memory per API process: it resets on restart, which only allows one early revalidation per key.
 */
export const DEFAULT_REVALIDATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_TRACKED_KEYS = 10_000;

export interface RevalidationCooldown {
  /** True, recording the attempt, when `key` may be revalidated now. */
  tryAcquire(key: string): boolean;
  /** Forgets an attempt that never started (e.g. scheduling it failed), so it can be retried. */
  release(key: string): void;
}

export function createRevalidationCooldown(
  options: { cooldownMs?: number; maxTrackedKeys?: number; now?: () => number } = {}
): RevalidationCooldown {
  const cooldownMs = options.cooldownMs ?? DEFAULT_REVALIDATION_COOLDOWN_MS;
  const maxTrackedKeys = options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS;
  const now = options.now ?? (() => Date.now());
  // Insertion order is attempt order, so the first key is the oldest attempt.
  const lastAttemptByKey = new Map<string, number>();

  return {
    tryAcquire(key) {
      const nowMs = now();
      const lastAttemptMs = lastAttemptByKey.get(key);
      if (lastAttemptMs !== undefined && nowMs - lastAttemptMs < cooldownMs) {
        return false;
      }
      lastAttemptByKey.delete(key);
      lastAttemptByKey.set(key, nowMs);
      if (lastAttemptByKey.size > maxTrackedKeys) {
        const oldestKey = lastAttemptByKey.keys().next().value;
        if (oldestKey !== undefined) {
          lastAttemptByKey.delete(oldestKey);
        }
      }
      return true;
    },
    release(key) {
      lastAttemptByKey.delete(key);
    },
  };
}
