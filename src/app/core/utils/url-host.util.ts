export type ReviewSourceHost = 'mobygames' | 'metacritic';

export interface SanitizeExternalHttpUrlOptions {
  allowedDomains?: readonly string[];
}

function hasUrlCredentials(url: URL): boolean {
  return url.username.length > 0 || url.password.length > 0;
}

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
    if (hasUrlCredentials(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function sanitizeExternalHttpUrl(
  input: string,
  options: SanitizeExternalHttpUrlOptions = {}
): URL | null {
  const parsed = parseHttpUrl(input);
  if (!parsed) {
    return null;
  }

  const allowedDomains = options.allowedDomains;
  if (allowedDomains && allowedDomains.length > 0) {
    const hostname = parsed.hostname.toLowerCase();
    const matchesAllowedDomain = allowedDomains.some((domain) =>
      hostIsDomainOrSubdomain(hostname, domain)
    );
    if (!matchesAllowedDomain) {
      return null;
    }
  }

  return parsed;
}

export function sanitizeExternalHttpUrlString(
  input: string,
  options: SanitizeExternalHttpUrlOptions = {}
): string | null {
  return sanitizeExternalHttpUrl(input, options)?.toString() ?? null;
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
