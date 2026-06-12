import { afterEach, describe, expect, it, vi } from 'vitest';

const isNativePlatformMock = vi.fn<() => boolean>();
const writeFileMock = vi.fn<() => Promise<{ uri: string }>>();
const deleteFileMock = vi.fn<() => Promise<void>>();
const shareMock = vi.fn<() => Promise<void>>();

vi.mock('./native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: (...args: unknown[]) => writeFileMock(...args),
    deleteFile: (...args: unknown[]) => deleteFileMock(...args),
  },
}));

vi.mock('@capacitor/share', () => ({
  Share: {
    share: (...args: unknown[]) => shareMock(...args),
  },
}));

import { presentShareFile } from './share-file.util';

const shareParams = {
  content: 'type,title\n"game","Example"',
  filename: 'game-shelf-export.csv',
  mimeType: 'text/csv;charset=utf-8',
};

type ShareNavigator = Navigator & {
  share?: (data: { files?: File[] }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
};

function stubNavigator(overrides: Partial<ShareNavigator>): void {
  vi.stubGlobal('navigator', overrides);
}

describe('presentShareFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    isNativePlatformMock.mockReset();
    writeFileMock.mockReset();
    deleteFileMock.mockReset();
    shareMock.mockReset();
  });

  function mockAnchorDownload(): { click: ReturnType<typeof vi.fn> } {
    const anchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLAnchorElement);
    return anchor;
  }

  function mockBlobUrls(): ReturnType<typeof vi.spyOn<typeof URL, 'revokeObjectURL'>> {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    return vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  }

  it('downloads via anchor when navigator.share is unavailable', async () => {
    stubNavigator({});

    const revokeSpy = mockBlobUrls();
    const anchor = mockAnchorDownload();

    await presentShareFile(shareParams);

    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.download).toBe(shareParams.filename);
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('uses Web Share API when sharing files is supported', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    stubNavigator({ share, canShare });

    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL');
    const anchor = mockAnchorDownload();

    await presentShareFile(shareParams);

    expect(share).toHaveBeenCalledOnce();
    expect(canShare).toHaveBeenCalledOnce();
    expect(createObjectUrlSpy).not.toHaveBeenCalled();
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it('uses Web Share API when canShare is not implemented', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });

    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL');
    const anchor = mockAnchorDownload();

    await presentShareFile(shareParams);

    expect(share).toHaveBeenCalledOnce();
    expect(createObjectUrlSpy).not.toHaveBeenCalled();
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it('falls back to anchor download when canShare rejects file sharing', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(false);
    stubNavigator({ share, canShare });

    mockBlobUrls();
    const anchor = mockAnchorDownload();

    await presentShareFile(shareParams);

    expect(share).not.toHaveBeenCalled();
    expect(anchor.click).toHaveBeenCalledOnce();
  });

  it('falls back to anchor download when share throws a non-cancel error', async () => {
    const share = vi.fn().mockRejectedValue(new Error('share failed'));
    const canShare = vi.fn().mockReturnValue(true);
    stubNavigator({ share, canShare });

    mockBlobUrls();
    const anchor = mockAnchorDownload();

    await presentShareFile(shareParams);

    expect(share).toHaveBeenCalledOnce();
    expect(anchor.click).toHaveBeenCalledOnce();
  });

  it('does not download when the user cancels share with AbortError', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Share canceled', 'AbortError'));
    const canShare = vi.fn().mockReturnValue(true);
    stubNavigator({ share, canShare });

    const revokeSpy = mockBlobUrls();
    const anchor = mockAnchorDownload();

    await presentShareFile(shareParams);

    expect(share).toHaveBeenCalledOnce();
    expect(anchor.click).not.toHaveBeenCalled();
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('falls back to anchor download when share rejects a non-error value', async () => {
    const share = vi.fn().mockRejectedValue('share unavailable');
    const canShare = vi.fn().mockReturnValue(true);
    stubNavigator({ share, canShare });

    mockBlobUrls();
    const anchor = mockAnchorDownload();

    await presentShareFile(shareParams);

    expect(share).toHaveBeenCalledOnce();
    expect(anchor.click).toHaveBeenCalledOnce();
  });

  it('does not download when the user cancels share with a cancel message', async () => {
    const share = vi.fn().mockRejectedValue(new Error('User canceled share'));
    const canShare = vi.fn().mockReturnValue(true);
    stubNavigator({ share, canShare });

    mockBlobUrls();
    const anchor = mockAnchorDownload();

    await presentShareFile(shareParams);

    expect(share).toHaveBeenCalledOnce();
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it('falls back to anchor download when File is unavailable', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    stubNavigator({ share, canShare });
    vi.stubGlobal('File', undefined);

    mockBlobUrls();
    const anchor = mockAnchorDownload();

    await presentShareFile(shareParams);

    expect(share).not.toHaveBeenCalled();
    expect(anchor.click).toHaveBeenCalledOnce();
  });

  it('stages files in cache and opens the native share sheet on Capacitor', async () => {
    isNativePlatformMock.mockReturnValue(true);
    writeFileMock.mockResolvedValue({ uri: 'file:///cache/game-shelf-export.csv' });
    deleteFileMock.mockResolvedValue(undefined);
    shareMock.mockResolvedValue(undefined);

    await presentShareFile(shareParams);

    expect(writeFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: shareParams.filename,
        data: shareParams.content,
        directory: 'CACHE',
      })
    );
    expect(shareMock).toHaveBeenCalledWith({ files: ['file:///cache/game-shelf-export.csv'] });
    expect(deleteFileMock).toHaveBeenCalled();
  });

  it('ignores native share cancellation errors', async () => {
    isNativePlatformMock.mockReturnValue(true);
    writeFileMock.mockResolvedValue({ uri: 'file:///cache/game-shelf-export.csv' });
    deleteFileMock.mockResolvedValue(undefined);
    shareMock.mockRejectedValue(new DOMException('Share canceled', 'AbortError'));

    await expect(presentShareFile(shareParams)).resolves.toBeUndefined();
    expect(deleteFileMock).toHaveBeenCalled();
  });

  it('rethrows unexpected native share failures', async () => {
    isNativePlatformMock.mockReturnValue(true);
    writeFileMock.mockResolvedValue({ uri: 'file:///cache/game-shelf-export.csv' });
    deleteFileMock.mockResolvedValue(undefined);
    shareMock.mockRejectedValue(new Error('share failed'));

    await expect(presentShareFile(shareParams)).rejects.toThrow('share failed');
    expect(deleteFileMock).toHaveBeenCalled();
  });

  it('falls back to anchor download when File construction throws', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    stubNavigator({ share, canShare });
    vi.stubGlobal(
      'File',
      vi.fn(() => {
        throw new Error('File unsupported');
      })
    );

    mockBlobUrls();
    const anchor = mockAnchorDownload();

    await presentShareFile(shareParams);

    expect(share).not.toHaveBeenCalled();
    expect(anchor.click).toHaveBeenCalledOnce();
  });
});
