import { describe, expect, it } from 'vitest';
import {
  buildEmulatorJsBiosUrl,
  buildEmulatorJsPlayShellUrl,
  isAllowedEmulatorJsBiosUrl,
  isAllowedEmulatorJsRomUrl,
  isSafeEmulatorJsBiosRelativePath,
  isSafeEmulatorJsCoreToken,
  isSafeEmulatorJsShaderFileName,
} from './emulatorjs-play-url';

describe('buildEmulatorJsPlayShellUrl', () => {
  const PINNED_DATA_PATH =
    'https://thetigeregg.github.io/game-shelf-assets/third-party/emulatorjs/4.2.3/';

  it('builds a play shell URL with normalized pathtodata', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/Nintendo%20NES__pid-18/game.nes',
      gameTitle: 'Test Game',
      pathToData: PINNED_DATA_PATH,
    });

    const parsed = new URL(href);
    expect(parsed.origin + parsed.pathname).toBe('https://example.com/assets/emulatorjs/play.html');
    expect(parsed.searchParams.get('core')).toBe('nes');
    expect(parsed.searchParams.get('pathtodata')).toBe(PINNED_DATA_PATH);
    expect(parsed.searchParams.get('title')).toBe('Test Game');
    expect(parsed.searchParams.get('rom')).toBe(
      'https://example.com/roms/Nintendo%20NES__pid-18/game.nes'
    );
    expect(parsed.searchParams.get('debug')).toBeNull();
    expect(parsed.searchParams.get('shader')).toBeNull();
  });

  it('appends shader when defaultShader is a safe value', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/x.nes',
      pathToData: PINNED_DATA_PATH,
      defaultShader: 'crt-lottes',
    });
    expect(new URL(href).searchParams.get('shader')).toBe('crt-lottes');
  });

  it('throws when defaultShader is unsafe', () => {
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'nes',
        romUrl: '/roms/x.nes',
        pathToData: PINNED_DATA_PATH,
        defaultShader: '../evil.glslp',
      })
    ).toThrow(/Invalid default shader/);
  });

  it('throws when pathToData is not the pinned immutable emulator asset path', () => {
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'nes',
        romUrl: '/roms/x.nes',
        pathToData: 'https://evil.example/data/',
      })
    ).toThrow(/Invalid EmulatorJS pathToData URL/);
  });

  it('normalizes pinned path by appending trailing slash when missing', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/x.nes',
      pathToData: PINNED_DATA_PATH.slice(0, -1),
    });

    expect(new URL(href).searchParams.get('pathtodata')).toBe(PINNED_DATA_PATH);
  });

  it('accepts same-origin self-hosted EmulatorJS runtime path', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/x.nes',
      pathToData: 'https://example.com/assets/emulatorjs/data',
    });
    expect(new URL(href).searchParams.get('pathtodata')).toBe(
      'https://example.com/assets/emulatorjs/data/'
    );
  });

  it('throws when core is not a safe token', () => {
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'nes<script>',
        romUrl: '/roms/x.nes',
        pathToData: PINNED_DATA_PATH,
      })
    ).toThrow(/Invalid emulator core/);
  });

  it('appends debug=1 when debug is true', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/x.nes',
      pathToData: PINNED_DATA_PATH,
      debug: true,
    });
    expect(new URL(href).searchParams.get('debug')).toBe('1');
  });

  it('accepts a custom play shell path', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'http://localhost:8100',
      core: 'gba',
      romUrl: 'http://localhost:8100/roms/a/b.gba',
      pathToData: PINNED_DATA_PATH,
      playShellPath: '/custom/play.html',
    });

    expect(new URL(href).pathname).toBe('/custom/play.html');
  });

  it('appends bios when a valid same-origin /bios/ URL is provided', () => {
    const biosUrl = 'https://example.com/bios/psx/scph1001.bin';
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'psx',
      romUrl: '/roms/game.bin',
      pathToData: PINNED_DATA_PATH,
      biosUrl,
    });
    expect(new URL(href).searchParams.get('bios')).toBe(biosUrl);
  });

  it('throws when bios URL is not under /bios/', () => {
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'psx',
        romUrl: '/roms/game.bin',
        pathToData: PINNED_DATA_PATH,
        biosUrl: 'https://example.com/roms/evil.bin',
      })
    ).toThrow(/Invalid BIOS URL/);
  });

  it('adds biosbase when using a non-default bios base path', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'psx',
      romUrl: '/roms/game.bin',
      pathToData: PINNED_DATA_PATH,
      biosUrl: 'https://example.com/public-bios/psx/scph1001.bin',
      biosBaseUrl: '/public-bios',
    });
    expect(new URL(href).searchParams.get('biosbase')).toBe('/public-bios');
  });

  it('appends loader_integrity when provided', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'psx',
      romUrl: '/roms/game.bin',
      pathToData: PINNED_DATA_PATH,
      loaderIntegrity: 'sha384-abc123+/=',
    });
    expect(new URL(href).searchParams.get('loader_integrity')).toBe('sha384-abc123+/=');
  });
});

describe('buildEmulatorJsBiosUrl', () => {
  it('joins biosBaseUrl and a safe relative path', () => {
    expect(buildEmulatorJsBiosUrl('https://app.test', '/bios', 'psx/scph1001.bin')).toBe(
      'https://app.test/bios/psx/scph1001.bin'
    );
  });

  it('returns null for traversal or empty segments', () => {
    expect(buildEmulatorJsBiosUrl('https://app.test', '/bios', '../x.bin')).toBeNull();
    expect(buildEmulatorJsBiosUrl('https://app.test', '/bios', 'a//b.bin')).toBeNull();
    expect(buildEmulatorJsBiosUrl('https://app.test', '/bios', '/abs.bin')).toBeNull();
  });

  it('supports custom bios base paths', () => {
    expect(buildEmulatorJsBiosUrl('https://app.test', '/public-bios', 'psx/scph1001.bin')).toBe(
      'https://app.test/public-bios/psx/scph1001.bin'
    );
  });
});

describe('isSafeEmulatorJsShaderFileName', () => {
  it('accepts single-segment preset names', () => {
    expect(isSafeEmulatorJsShaderFileName('crt-geom.glslp')).toBe(true);
    expect(isSafeEmulatorJsShaderFileName('crt-lottes')).toBe(true);
  });

  it('rejects paths and bad characters', () => {
    expect(isSafeEmulatorJsShaderFileName('a/b.glslp')).toBe(false);
    expect(isSafeEmulatorJsShaderFileName('.hidden.glslp')).toBe(false);
    expect(isSafeEmulatorJsShaderFileName('no-ext')).toBe(true);
    expect(isSafeEmulatorJsShaderFileName('')).toBe(false);
  });
});

describe('isSafeEmulatorJsCoreToken', () => {
  it('accepts known EmulatorJS-style core tokens', () => {
    expect(isSafeEmulatorJsCoreToken('nes')).toBe(true);
    expect(isSafeEmulatorJsCoreToken('segaCD')).toBe(true);
    expect(isSafeEmulatorJsCoreToken('psx_hle')).toBe(true);
  });

  it('rejects invalid or unsafe core values', () => {
    expect(isSafeEmulatorJsCoreToken('')).toBe(false);
    expect(isSafeEmulatorJsCoreToken('../psx')).toBe(false);
    expect(isSafeEmulatorJsCoreToken('psx<script>')).toBe(false);
  });
});

describe('isSafeEmulatorJsBiosRelativePath', () => {
  it('accepts normal nested paths', () => {
    expect(isSafeEmulatorJsBiosRelativePath('psx/scph1001.bin')).toBe(true);
  });

  it('rejects unsafe paths', () => {
    expect(isSafeEmulatorJsBiosRelativePath('..')).toBe(false);
    expect(isSafeEmulatorJsBiosRelativePath('a/../b')).toBe(false);
  });
});

describe('isAllowedEmulatorJsBiosUrl', () => {
  it('allows same-origin /bios/ URLs', () => {
    expect(
      isAllowedEmulatorJsBiosUrl('https://app.test/bios/psx/scph1001.bin', 'https://app.test')
    ).toBe(true);
    expect(isAllowedEmulatorJsBiosUrl('/bios/x.bin', 'https://app.test')).toBe(true);
  });

  it('rejects other origins and paths', () => {
    expect(isAllowedEmulatorJsBiosUrl('https://evil.test/bios/x.bin', 'https://app.test')).toBe(
      false
    );
    expect(isAllowedEmulatorJsBiosUrl('https://app.test/roms/x.bin', 'https://app.test')).toBe(
      false
    );
  });

  it('supports custom bios base allowlist paths', () => {
    expect(
      isAllowedEmulatorJsBiosUrl(
        'https://app.test/public-bios/psx/scph1001.bin',
        'https://app.test',
        '/public-bios'
      )
    ).toBe(true);
    expect(
      isAllowedEmulatorJsBiosUrl(
        'https://app.test/bios/psx/scph1001.bin',
        'https://app.test',
        '/public-bios'
      )
    ).toBe(false);
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
