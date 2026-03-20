import { parseHttpUrl } from './url-host.util';

export function openExternalUrl(url: string | null | undefined): void {
  if (typeof url !== 'string') {
    return;
  }

  const parsedUrl = resolveOpenableUrl(url);
  if (!parsedUrl) {
    return;
  }

  const newWindow = window.open(parsedUrl.href, '_blank', 'noopener,noreferrer');

  if (newWindow) {
    newWindow.opener = null;
  }
}

function resolveOpenableUrl(url: string): URL | null {
  const trimmedUrl = url.trim();

  if (trimmedUrl.length === 0) {
    return null;
  }

  if (trimmedUrl.startsWith('/') && !trimmedUrl.startsWith('//')) {
    try {
      const parsedUrl = new URL(trimmedUrl, window.location.origin);
      return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' ? parsedUrl : null;
    } catch {
      return null;
    }
  }

  return parseHttpUrl(trimmedUrl);
}
