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

export function resolvePriceFetchedAtMs(payload: Record<string, unknown>): number | null {
  // Freshness should track successful unified pricing snapshots, not fetch attempts.
  if (!hasUnifiedPriceValue(payload)) {
    return null;
  }

  const candidates = [payload['priceFetchedAt']];

  for (const candidate of candidates) {
    const normalized = normalizeNonEmptyString(candidate);
    if (!normalized) {
      continue;
    }
    const parsedMs = Date.parse(normalized);
    if (Number.isFinite(parsedMs)) {
      return parsedMs;
    }
  }

  return null;
}
