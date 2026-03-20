import { parseHttpUrl } from './url-host.util';

export function openExternalUrl(url: string | null | undefined): void {
  if (typeof url !== 'string') {
    return;
  }

  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl) {
    return;
  }

  const newWindow = window.open(parsedUrl.href, '_blank', 'noopener,noreferrer');

  if (newWindow) {
    newWindow.opener = null;
  }
}
