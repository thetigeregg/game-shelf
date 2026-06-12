import { FileViewer } from '@capacitor/file-viewer';
import { isNativePlatform } from './native-platform.util';
import { openExternalUrl, resolveOpenableUrl } from './open-external-url';

export async function openDocumentUrl(url: string | null | undefined): Promise<void> {
  if (typeof url !== 'string') {
    return;
  }

  const parsedUrl = resolveOpenableUrl(url);
  if (!parsedUrl) {
    return;
  }

  if (!isNativePlatform()) {
    openExternalUrl(parsedUrl.href);
    return;
  }

  await FileViewer.openDocumentFromUrl({ url: parsedUrl.href });
}
