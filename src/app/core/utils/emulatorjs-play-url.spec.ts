import { describe, expect, it } from 'vitest';
import { buildEmulatorJsPlayShellUrl, isAllowedEmulatorJsRomUrl } from './emulatorjs-play-url';

describe('buildEmulatorJsPlayShellUrl', () => {
  it('builds a play shell URL with normalized pathtodata', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/Nintendo%20NES__pid-18/game.nes',
      gameTitle: 'Test Game',
      pathToData: 'https://cdn.emulatorjs.org/stable/data',
    });

    const parsed = new URL(href);
    expect(parsed.origin + parsed.pathname).toBe('https://example.com/assets/emulatorjs/play.html');
    expect(parsed.searchParams.get('core')).toBe('nes');
    expect(parsed.searchParams.get('pathtodata')).toBe('https://cdn.emulatorjs.org/stable/data/');
    expect(parsed.searchParams.get('title')).toBe('Test Game');
    expect(parsed.searchParams.get('rom')).toBe(
      'https://example.com/roms/Nintendo%20NES__pid-18/game.nes'
    );
  });

  it('accepts a custom play shell path', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'http://localhost:8100',
      core: 'gba',
      romUrl: 'http://localhost:8100/roms/a/b.gba',
      pathToData: 'https://cdn.emulatorjs.org/stable/data/',
      playShellPath: '/custom/play.html',
    });

    expect(new URL(href).pathname).toBe('/custom/play.html');
  });
});

describe('isAllowedEmulatorJsRomUrl', () => {
  it('allows same-origin /roms/ URLs', () => {
    expect(
      isAllowedEmulatorJsRomUrl('https://app.test/roms/folder/file.nes', 'https://app.test')
    ).toBe(true);
    expect(isAllowedEmulatorJsRomUrl('/roms/x', 'https://app.test')).toBe(true);
  });

  it('rejects other origins and paths', () => {
    expect(isAllowedEmulatorJsRomUrl('https://evil.example/roms/x', 'https://app.test')).toBe(
      false
    );
    expect(isAllowedEmulatorJsRomUrl('https://app.test/manuals/x.pdf', 'https://app.test')).toBe(
      false
    );
    expect(isAllowedEmulatorJsRomUrl('not-a-url', 'https://app.test')).toBe(false);
  });
});
