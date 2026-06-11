import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNativePlatform } from './native-platform.util';

export interface ShareFileParams {
  content: string;
  filename: string;
  mimeType: string;
}

export async function presentShareFile(params: ShareFileParams): Promise<void> {
  if (isNativePlatform()) {
    await presentNativeShareFile(params);
    return;
  }

  const blob = new Blob([params.content], { type: params.mimeType });

  const webNavigator = navigator as Navigator & {
    share?: (data: { title?: string; text?: string; files?: File[] }) => Promise<void>;
    canShare?: (data: { files?: File[] }) => boolean;
  };

  if (typeof webNavigator.share === 'function') {
    const file = tryCreateFile(blob, params.filename, params.mimeType);

    if (file) {
      const canShareFiles =
        typeof webNavigator.canShare !== 'function' || webNavigator.canShare({ files: [file] });

      if (canShareFiles) {
        try {
          await webNavigator.share({
            files: [file],
          });
          return;
        } catch (error: unknown) {
          if (isShareCancelError(error)) {
            return;
          }
        }
      }
    }
  }

  const objectUrl = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = params.filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Stages the file in the app cache directory and opens the native share sheet. */
async function presentNativeShareFile(params: ShareFileParams): Promise<void> {
  const written = await Filesystem.writeFile({
    path: params.filename,
    data: params.content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });

  try {
    await Share.share({ files: [written.uri] });
  } catch (error: unknown) {
    if (!isShareCancelError(error)) {
      throw error;
    }
  } finally {
    await Filesystem.deleteFile({ path: params.filename, directory: Directory.Cache }).catch(
      () => undefined
    );
  }
}

function tryCreateFile(blob: Blob, filename: string, mimeType: string): File | null {
  try {
    if (typeof File !== 'function') {
      return null;
    }

    return new File([blob], filename, { type: mimeType });
  } catch {
    return null;
  }
}

function isShareCancelError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }

  const message = error instanceof Error ? error.message : '';
  return /abort|cancel/i.test(message);
}
