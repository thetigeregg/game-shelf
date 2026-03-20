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

  it('does not fail when the browser blocks the popup', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    expect(() => {
      openExternalUrl('https://example.com/game');
    }).not.toThrow();
    expect(openSpy).toHaveBeenCalledOnce();
  });
});
