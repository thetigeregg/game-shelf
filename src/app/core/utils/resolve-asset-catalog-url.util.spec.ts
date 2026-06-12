import { afterEach, describe, expect, it, vi } from 'vitest';

const isNativePlatformMock = vi.fn<() => boolean>();

vi.mock('./native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

import { resolveAssetCatalogUrl } from './resolve-asset-catalog-url.util';

describe('resolveAssetCatalogUrl', () => {
  afterEach(() => {
    isNativePlatformMock.mockReset();
  });

  const buildFromClientBase = (relativePath: string) => `/client-base/${relativePath}`;

  it('uses client base on native and ignores loopback server urls', () => {
    isNativePlatformMock.mockReturnValue(true);

    expect(
      resolveAssetCatalogUrl(
        'PlayStation 2__pid-8/Game.pdf',
        'http://127.0.0.1:10028/manuals/PlayStation%202__pid-8/Game.pdf',
        buildFromClientBase
      )
    ).toBe('/client-base/PlayStation 2__pid-8/Game.pdf');
  });

  it('uses client base on native and ignores relative server urls', () => {
    isNativePlatformMock.mockReturnValue(true);

    expect(
      resolveAssetCatalogUrl(
        'PlayStation 2__pid-8/Game.pdf',
        '/manuals/PlayStation%202__pid-8/Game.pdf',
        buildFromClientBase
      )
    ).toBe('/client-base/PlayStation 2__pid-8/Game.pdf');
  });

  it('prefers server url on web when present', () => {
    isNativePlatformMock.mockReturnValue(false);

    expect(
      resolveAssetCatalogUrl(
        'PlayStation 2__pid-8/Game.pdf',
        '/manuals/PlayStation%202__pid-8/Game.pdf',
        buildFromClientBase
      )
    ).toBe('/manuals/PlayStation%202__pid-8/Game.pdf');
  });

  it('falls back to client base on web when server url is blank', () => {
    isNativePlatformMock.mockReturnValue(false);

    expect(
      resolveAssetCatalogUrl('PlayStation 2__pid-8/Game.pdf', '   ', buildFromClientBase)
    ).toBe('/client-base/PlayStation 2__pid-8/Game.pdf');
  });
});
