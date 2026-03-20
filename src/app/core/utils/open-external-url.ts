export function openExternalUrl(url: string | null | undefined): void {
  if (typeof url !== 'string') {
    return;
  }

  const normalizedUrl = url.trim();
  if (normalizedUrl.length === 0) {
    return;
  }

  const newWindow = window.open(normalizedUrl, '_blank', 'noopener,noreferrer');

  if (newWindow) {
    newWindow.opener = null;
  }
}
