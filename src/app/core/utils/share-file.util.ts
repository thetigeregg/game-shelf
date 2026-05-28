export interface ShareFileParams {
  content: string;
  filename: string;
  mimeType: string;
}

export async function presentShareFile(params: ShareFileParams): Promise<void> {
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
