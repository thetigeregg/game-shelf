function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePreferredPsPricesUrl(value: unknown): string | null {
  const normalized = normalizeNonEmptyString(value);
  if (normalized === null) {
    return null;
  }

  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }

  if (normalized.startsWith('http://')) {
    return `https://${normalized.slice('http://'.length)}`;
  }

  return normalized;
}

export function resolvePreferredPsPricesUrl(payload: Record<string, unknown>): string | null {
  const explicitPsPricesUrl = normalizePreferredPsPricesUrl(payload['psPricesUrl']);
  if (explicitPsPricesUrl) {
    return explicitPsPricesUrl;
  }

  if (normalizeNonEmptyString(payload['priceSource']) !== 'psprices') {
    return null;
  }

  return normalizePreferredPsPricesUrl(payload['priceUrl']);
}
