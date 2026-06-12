import { describe, expect, it, vi, afterEach } from 'vitest';

const isNativePlatformMock = vi.fn<() => boolean>();
const openInSystemBrowserMock = vi.fn<() => Promise<void>>();

vi.mock('./native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock('@capacitor/inappbrowser', () => ({
  DefaultSystemBrowserOptions: {},
  InAppBrowser: {
    openInSystemBrowser: (...args: unknown[]) => openInSystemBrowserMock(...args),
  },
}));

import { openExternalUrl } from './open-external-url';

describe('openExternalUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    isNativePlatformMock.mockReset();
    openInSystemBrowserMock.mockReset();
  });

  it('ignores missing and blank urls', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    openExternalUrl(null);
    openExternalUrl(undefined);
    openExternalUrl('');
    openExternalUrl('   ');

    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens the url in a new tab with noopener and noreferrer', () => {
    const openedWindow = { opener: {} } as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(openedWindow);

    openExternalUrl(' https://example.com/game ');

    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/game',
      '_blank',
      'noopener,noreferrer'
    );
    expect(openedWindow.opener).toBeNull();
  });

  it('normalizes protocol-relative urls before opening them', () => {
    const openedWindow = { opener: {} } as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(openedWindow);

    openExternalUrl('//example.com/game');

    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/game',
      '_blank',
      'noopener,noreferrer'
    );
    expect(openedWindow.opener).toBeNull();
  });

  it('resolves same-origin root-relative urls before opening them', () => {
    const openedWindow = { opener: {} } as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(openedWindow);
    const expectedUrl = new URL('/manuals/ps2/game-manual.pdf', window.location.origin).href;

    openExternalUrl('/manuals/ps2/game-manual.pdf');

    expect(openSpy).toHaveBeenCalledWith(expectedUrl, '_blank', 'noopener,noreferrer');
    expect(openedWindow.opener).toBeNull();
  });

  it('rejects malformed and non-http(s) urls', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    openExternalUrl('javascript:alert(1)');
    openExternalUrl('data:text/html,test');
    openExternalUrl('http://[::1]:notaport');

    expect(openSpy).not.toHaveBeenCalled();
  });

  it('does not fail when the browser blocks the popup', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    expect(() => {
      openExternalUrl('https://example.com/game');
    }).not.toThrow();
    expect(openSpy).toHaveBeenCalledOnce();
  });

  it('opens links in the native system browser on Capacitor', () => {
    isNativePlatformMock.mockReturnValue(true);
    openInSystemBrowserMock.mockResolvedValue(undefined);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    openExternalUrl('https://example.com/native');

    expect(openInSystemBrowserMock).toHaveBeenCalledWith({
      url: 'https://example.com/native',
      options: {},
    });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('logs native browser failures without throwing', async () => {
    isNativePlatformMock.mockReturnValue(true);
    openInSystemBrowserMock.mockRejectedValue(new Error('browser unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    openExternalUrl('https://example.com/native');
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(
      '[open-external-url] system_browser_open_failed',
      expect.any(Error)
    );
  });

  it('ignores invalid urls on native without opening the system browser', () => {
    isNativePlatformMock.mockReturnValue(true);

    openExternalUrl('javascript:alert(1)');

    expect(openInSystemBrowserMock).not.toHaveBeenCalled();
  });
});
