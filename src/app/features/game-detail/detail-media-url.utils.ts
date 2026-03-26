import { environment } from '../../../environments/environment';

const PLACEHOLDER_SRC = 'assets/icon/placeholder.png';
const IGDB_HOST = 'images.igdb.com';
const THE_GAMES_DB_HOST = 'cdn.thegamesdb.net';
const IGDB_PATH_PREFIX = '/igdb/image/upload/';
const THE_GAMES_DB_PATH_PREFIX = '/images/';
const IGDB_SCREENSHOT_SIZE_PATTERN =
  /(\/igdb\/image\/upload\/)t_(?:screenshot_(?:med|big|huge)|720p|1080p)(?:_2x)?\//;

export function toDetailMediaRenderUrl(source: string | null | undefined): string | null {
  const normalized = normalizeMediaSourceUrl(source);

  if (!normalized) {
    return null;
  }

  return buildProxyFetchUrl(withIgdbRetinaVariant(normalized));
}

export function toDetailMediaBackdropUrl(source: string | null | undefined): string | null {
  const renderUrl = toDetailMediaRenderUrl(source);

  if (!renderUrl) {
    return null;
  }

  if (renderUrl === PLACEHOLDER_SRC) {
    return renderUrl;
  }

  const sourceUrl = extractProxiedSourceUrl(renderUrl);
  const optimizedSourceUrl = sourceUrl.replace(IGDB_SCREENSHOT_SIZE_PATTERN, '$1t_screenshot_med/');
  return buildProxyFetchUrl(optimizedSourceUrl);
}

export function getDetailMediaPlaceholderSrc(): string {
  return PLACEHOLDER_SRC;
}

function normalizeMediaSourceUrl(source: string | null | undefined): string | null {
  const normalized = typeof source === 'string' ? source.trim() : '';

  return normalized.length > 0 ? normalized : null;
}

function withIgdbRetinaVariant(url: string): string {
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

function buildProxyFetchUrl(sourceUrl: string): string {
  const proxyEligibleUrl = toProxyEligibleImageUrl(sourceUrl);

  if (!proxyEligibleUrl) {
    return sourceUrl;
  }

  return `${environment.gameApiBaseUrl}/v1/images/proxy?url=${encodeURIComponent(proxyEligibleUrl)}`;
}

function toProxyEligibleImageUrl(sourceUrl: string): string | null {
  const normalizedSourceUrl = sourceUrl.startsWith('//') ? `https:${sourceUrl}` : sourceUrl;

  try {
    const parsed = new URL(normalizedSourceUrl);

    if (parsed.protocol !== 'https:') {
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
  } catch {
    return null;
  }
}

function extractProxiedSourceUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    const proxiedSourceUrl = parsed.searchParams.get('url');

    return proxiedSourceUrl ? proxiedSourceUrl : url;
  } catch {
    return url;
  }
}
