function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasUnifiedPriceValue(payload: Record<string, unknown>): boolean {
  if (payload['priceIsFree'] === true) {
    return true;
  }

  const amountCandidate = payload['priceAmount'];
  if (typeof amountCandidate === 'number') {
    return Number.isFinite(amountCandidate) && amountCandidate >= 0;
  }
  if (typeof amountCandidate === 'string') {
    const parsed = Number.parseFloat(amountCandidate.trim());
    return Number.isFinite(parsed) && parsed >= 0;
  }

  return false;
}

/**
 * When a source last looked the game up, for sources whose attempt time counts: a PlayStation
 * Store lookup that found nothing still waits for the next stale window instead of being retried
 * on every pricing pass, which would mean hourly searches of the store's unofficial API.
 */
const ATTEMPT_FETCHED_AT_KEY_BY_SOURCE: Readonly<Record<string, string>> = {
  playstation_store: 'playstationStoreFetchedAt',
};

function parseTimestampMs(value: unknown): number | null {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }
  const parsedMs = Date.parse(normalized);
  return Number.isFinite(parsedMs) ? parsedMs : null;
}

/**
 * When the game's price was last fetched, or null when it should be fetched now.
 *
 * Normally this is the last successful unified price (`priceFetchedAt`). With `expectedSource`, a
 * price from another source doesn't count: the platform's prices have moved (e.g. PS4/PS5 from
 * psprices to the PlayStation Store), so the game is looked up on the new source at the next
 * refresh. For the PlayStation Store, its last attempt counts instead, found or not.
 */
export function resolvePriceFetchedAtMs(
  payload: Record<string, unknown>,
  expectedSource?: string | null
): number | null {
  const hasPriceFromSource =
    hasUnifiedPriceValue(payload) && (!expectedSource || payload['priceSource'] === expectedSource);
  if (hasPriceFromSource) {
    return parseTimestampMs(payload['priceFetchedAt']);
  }

  const attemptKey = expectedSource ? ATTEMPT_FETCHED_AT_KEY_BY_SOURCE[expectedSource] : undefined;
  return attemptKey ? parseTimestampMs(payload[attemptKey]) : null;
}
