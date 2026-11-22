/**
 * Adds `fetchedAt` (when the provider's data was read) to a provider lookup response, so the
 * client can show how recent HLTB times or review scores are. A cache hit reports the cache
 * entry's `updated_at`, a fresh fetch the current time. Non-object payloads are returned as-is.
 */
export function withFetchedAt(payload: unknown, fetchedAt: string | number | Date): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const timestamp = fetchedAt instanceof Date ? fetchedAt.getTime() : new Date(fetchedAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return payload;
  }

  return { ...(payload as Record<string, unknown>), fetchedAt: new Date(timestamp).toISOString() };
}

/** Reads a valid `fetchedAt` back from a provider lookup response, else null. */
export function readFetchedAt(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>)['fetchedAt'];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
