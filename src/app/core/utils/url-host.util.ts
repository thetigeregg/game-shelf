export type ReviewSourceHost = 'mobygames' | 'metacritic';

export function parseHttpUrl(input: string): URL | null {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (raw.length === 0) {
    return null;
  }

  const withScheme = raw.startsWith('//') ? `https:${raw}` : raw;
  if (!withScheme.startsWith('http://') && !withScheme.startsWith('https://')) {
    return null;
  }

  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function hostIsDomainOrSubdomain(hostname: string, baseDomain: string): boolean {
  const host = typeof hostname === 'string' ? hostname.trim().toLowerCase() : '';
  const base = typeof baseDomain === 'string' ? baseDomain.trim().toLowerCase() : '';
  if (host.length === 0 || base.length === 0) {
    return false;
  }

  return host === base || host.endsWith(`.${base}`);
}

export function detectReviewSourceFromUrl(url: string): ReviewSourceHost | null {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (hostIsDomainOrSubdomain(host, 'mobygames.com')) {
    return 'mobygames';
  }
  if (hostIsDomainOrSubdomain(host, 'metacritic.com')) {
    return 'metacritic';
  }

  return null;
}
