import { DefaultSystemBrowserOptions, InAppBrowser } from '@capacitor/inappbrowser';
import { parseHttpUrl } from './url-host.util';
import { isNativePlatform } from './native-platform.util';

export function openExternalUrl(url: string | null | undefined): void {
  if (typeof url !== 'string') {
    return;
  }

  const parsedUrl = resolveOpenableUrl(url);
  if (!parsedUrl) {
    return;
  }

  if (isNativePlatform()) {
    // window.open is unreliable inside the Capacitor WKWebView; use the system
    // browser sheet (SFSafariViewController) instead.
    void InAppBrowser.openInSystemBrowser({
      url: parsedUrl.href,
      options: DefaultSystemBrowserOptions,
    }).catch((error: unknown) => {
      console.error('[open-external-url] system_browser_open_failed', error);
    });
    return;
  }

  const newWindow = window.open(parsedUrl.href, '_blank', 'noopener,noreferrer');

  if (newWindow) {
    newWindow.opener = null;
  }
}

export function resolveOpenableUrl(url: string): URL | null {
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
