import { describe, expect, it } from 'vitest';
import {
  buildEmulatorJsBiosUrl,
  buildEmulatorJsPlayShellUrl,
  isAllowedEmulatorJsBiosUrl,
  isAllowedEmulatorJsRomUrl,
  isSafeEmulatorJsBiosRelativePath,
  isSafeEmulatorJsShaderFileName,
} from './emulatorjs-play-url';

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
    expect(parsed.searchParams.get('debug')).toBeNull();
    expect(parsed.searchParams.get('shader')).toBeNull();
  });

  it('appends shader when defaultShader is a safe value', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/x.nes',
      pathToData: 'https://cdn.emulatorjs.org/stable/data/',
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
        pathToData: 'https://cdn.emulatorjs.org/stable/data/',
        defaultShader: '../evil.glslp',
      })
    ).toThrow(/Invalid default shader/);
  });

  it('appends debug=1 when debug is true', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/x.nes',
      pathToData: 'https://cdn.emulatorjs.org/stable/data/',
      debug: true,
    });
    expect(new URL(href).searchParams.get('debug')).toBe('1');
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

  it('appends bios when a valid same-origin /bios/ URL is provided', () => {
    const biosUrl = 'https://example.com/bios/psx/scph1001.bin';
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'psx',
      romUrl: '/roms/game.bin',
      pathToData: 'https://cdn.emulatorjs.org/stable/data/',
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
        pathToData: 'https://cdn.emulatorjs.org/stable/data/',
        biosUrl: 'https://example.com/roms/evil.bin',
      })
    ).toThrow(/Invalid BIOS URL/);
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
