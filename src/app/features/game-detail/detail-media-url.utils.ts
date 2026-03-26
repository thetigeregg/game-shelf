import { environment } from '../../../environments/environment';
import {
  buildProxyImageUrl,
  normalizeImageSourceUrl,
  withIgdbRetinaVariant,
} from '../../core/utils/image-url.utils';

const PLACEHOLDER_SRC = 'assets/icon/placeholder.png';
const IGDB_SCREENSHOT_SIZE_PATTERN =
  /(\/igdb\/image\/upload\/)t_(?:screenshot_(?:med|big|huge)|720p|1080p)(?:_2x)?\//;

export function toDetailMediaRenderUrl(source: string | null | undefined): string | null {
  const normalized = normalizeImageSourceUrl(source);

  if (!normalized) {
    return null;
  }

  return buildProxyImageUrl(withIgdbRetinaVariant(normalized), environment.gameApiBaseUrl);
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
  const backdropUrl = buildProxyImageUrl(optimizedSourceUrl, environment.gameApiBaseUrl);
  const retryParam = extractRetryParam(renderUrl);

  if (!retryParam) {
    return backdropUrl;
  }

  try {
    const parsedBackdropUrl = new URL(backdropUrl, window.location.origin);
    parsedBackdropUrl.searchParams.set('_img_retry', retryParam);
    return parsedBackdropUrl.toString();
  } catch {
    return backdropUrl;
  }
}

export function getDetailMediaPlaceholderSrc(): string {
  return PLACEHOLDER_SRC;
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

function extractRetryParam(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const retryParam = parsed.searchParams.get('_img_retry');
    return retryParam && retryParam.trim().length > 0 ? retryParam : null;
  } catch {
    return null;
  }
}
