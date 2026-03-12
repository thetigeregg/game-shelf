function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolvePreferredPsPricesUrl(payload: Record<string, unknown>): string | null {
  const explicitPsPricesUrl = normalizeNonEmptyString(payload['psPricesUrl']);
  if (explicitPsPricesUrl) {
    return explicitPsPricesUrl;
  }

  if (normalizeNonEmptyString(payload['priceSource']) !== 'psprices') {
    return null;
  }

  return normalizeNonEmptyString(payload['priceUrl']);
}
