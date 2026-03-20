import { describe, expect, it, vi, afterEach } from 'vitest';

import { openExternalUrl } from './open-external-url';

describe('openExternalUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it('rejects root-relative urls when URL resolution produces a non-http protocol', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const OriginalUrl = URL;

    vi.stubGlobal(
      'URL',
      class URLStub extends OriginalUrl {
        constructor(input: string | URL, base?: string | URL) {
          if (String(input).startsWith('/')) {
            super('ftp://example.com/manual.pdf');
            return;
          }

          super(input, base);
        }
      }
    );

    openExternalUrl('/manuals/ps2/game-manual.pdf');

    expect(openSpy).not.toHaveBeenCalled();
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
});
