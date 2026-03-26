import { parseHttpUrl, sanitizeExternalHttpUrlString } from './url-host.util';

const IGDB_HOST = 'images.igdb.com';
const THE_GAMES_DB_HOST = 'cdn.thegamesdb.net';
const IGDB_PATH_PREFIX = '/igdb/image/upload/';
const THE_GAMES_DB_PATH_PREFIX = '/images/';

export function normalizeImageSourceUrl(source: string | null | undefined): string | null {
  const normalized = typeof source === 'string' ? source.trim() : '';

  if (normalized.length === 0) {
    return null;
  }

  if (normalized.startsWith('//') || /^https?:\/\//i.test(normalized)) {
    return sanitizeExternalHttpUrlString(normalized);
  }

  return normalized;
}

export function withIgdbRetinaVariant(url: string): string {
  return url.replace(
    /(\/igdb\/image\/upload\/)(t_[^/]+)(\/)/,
    (_match, prefix: string, sizeToken: string, suffix: string) => {
      if (sizeToken.endsWith('_2x')) {
        return `${prefix}${sizeToken}${suffix}`;
      }

      return `${prefix}${sizeToken}_2x${suffix}`;
    }
  );
}

export function buildProxyImageUrl(sourceUrl: string, apiBaseUrl: string): string {
  const proxyEligibleUrl = toProxyEligibleImageUrl(sourceUrl);

  if (!proxyEligibleUrl) {
    return sourceUrl;
  }

  return `${apiBaseUrl}/v1/images/proxy?url=${encodeURIComponent(proxyEligibleUrl)}`;
}

export function toProxyEligibleImageUrl(sourceUrl: string): string | null {
  const parsed = parseHttpUrl(sourceUrl);

  if (!parsed || parsed.protocol !== 'https:') {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const isTheGamesDb =
    hostname === THE_GAMES_DB_HOST && parsed.pathname.startsWith(THE_GAMES_DB_PATH_PREFIX);
  const isIgdb = hostname === IGDB_HOST && parsed.pathname.startsWith(IGDB_PATH_PREFIX);

  if (!isTheGamesDb && !isIgdb) {
    return null;
  }

  return parsed.toString();
}

export function isDataOrBlobUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();

  return normalized.startsWith('data:') || normalized.startsWith('blob:');
}
