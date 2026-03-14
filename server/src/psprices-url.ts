function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePreferredPsPricesUrl(value: unknown): string | null {
  let normalized = normalizeNonEmptyString(value);
  if (normalized === null) {
    return null;
  }

  if (normalized.startsWith('//')) {
    normalized = `https:${normalized}`;
  } else if (normalized.startsWith('http://')) {
    normalized = `https://${normalized.slice('http://'.length)}`;
  } else if (!normalized.startsWith('https://')) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  const rawHostname = parsed.hostname.toLowerCase();
  const hostname = rawHostname.startsWith('www.') ? rawHostname.slice(4) : rawHostname;
  if (hostname !== 'psprices.com' && !hostname.endsWith('.psprices.com')) {
    return null;
  }

  parsed.protocol = 'https:';
  parsed.hostname = hostname;
  parsed.port = '';
  return parsed.toString();
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
