import { afterEach, describe, expect, it, vi } from 'vitest';

const isNativePlatformMock = vi.fn<() => boolean>();
const openDocumentFromUrlMock = vi.fn<() => Promise<void>>();
const openExternalUrlMock = vi.fn<() => void>();

vi.mock('./native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock('@capacitor/file-viewer', () => ({
  FileViewer: {
    openDocumentFromUrl: (...args: unknown[]) => openDocumentFromUrlMock(...args),
  },
}));

vi.mock('./open-external-url', () => ({
  resolveOpenableUrl: (url: string) => {
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

    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      return null;
    }

    try {
      return new URL(trimmedUrl);
    } catch {
      return null;
    }
  },
  openExternalUrl: (...args: unknown[]) => {
    openExternalUrlMock(...args);
  },
}));

import { openDocumentUrl } from './open-document-url.util';

describe('openDocumentUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    isNativePlatformMock.mockReset();
    openDocumentFromUrlMock.mockReset();
    openExternalUrlMock.mockReset();
  });

  it('ignores missing and blank urls', async () => {
    await openDocumentUrl(null);
    await openDocumentUrl(undefined);
    await openDocumentUrl('');
    await openDocumentUrl('   ');

    expect(openExternalUrlMock).not.toHaveBeenCalled();
    expect(openDocumentFromUrlMock).not.toHaveBeenCalled();
  });

  it('ignores invalid urls', async () => {
    await openDocumentUrl('javascript:alert(1)');

    expect(openExternalUrlMock).not.toHaveBeenCalled();
    expect(openDocumentFromUrlMock).not.toHaveBeenCalled();
  });

  it('delegates to openExternalUrl on web', async () => {
    isNativePlatformMock.mockReturnValue(false);

    await openDocumentUrl('https://example.com/manuals/game.pdf');

    expect(openExternalUrlMock).toHaveBeenCalledWith('https://example.com/manuals/game.pdf');
    expect(openDocumentFromUrlMock).not.toHaveBeenCalled();
  });

  it('resolves root-relative manual urls before opening on web', async () => {
    isNativePlatformMock.mockReturnValue(false);
    const expectedUrl = new URL('/manuals/ps2/game-manual.pdf', window.location.origin).href;

    await openDocumentUrl('/manuals/ps2/game-manual.pdf');

    expect(openExternalUrlMock).toHaveBeenCalledWith(expectedUrl);
    expect(openDocumentFromUrlMock).not.toHaveBeenCalled();
  });

  it('opens documents with FileViewer on native', async () => {
    isNativePlatformMock.mockReturnValue(true);
    openDocumentFromUrlMock.mockResolvedValue(undefined);

    await openDocumentUrl('https://example.com/manuals/game.pdf');

    expect(openDocumentFromUrlMock).toHaveBeenCalledWith({
      url: 'https://example.com/manuals/game.pdf',
    });
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it('propagates native FileViewer failures without falling back to openExternalUrl', async () => {
    isNativePlatformMock.mockReturnValue(true);
    openDocumentFromUrlMock.mockRejectedValue(new Error('download failed'));

    await expect(openDocumentUrl('https://example.com/manuals/game.pdf')).rejects.toThrow(
      'download failed'
    );
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });
});
