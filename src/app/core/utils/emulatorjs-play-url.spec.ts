import { describe, expect, it } from 'vitest';
import {
  buildEmulatorJsBiosUrl,
  buildEmulatorJsPlayShellUrl,
  isAllowedEmulatorJsBiosUrl,
  isAllowedEmulatorJsRomUrl,
  isValidEmulatorJsLoaderIntegrity,
  isSafeEmulatorJsBiosRelativePath,
  isSafeEmulatorJsCoreToken,
  isSafeEmulatorJsShaderFileName,
} from './emulatorjs-play-url';
import {
  EMULATORJS_DEFAULT_PATH_TO_DATA,
  EMULATORJS_PINNED_PATH_TO_DATA,
} from '../config/emulatorjs.constants';

describe('buildEmulatorJsPlayShellUrl', () => {
  const PINNED_DATA_PATH = EMULATORJS_PINNED_PATH_TO_DATA;
  const VALID_LOADER_INTEGRITY = 'sha384-abc123+/=';

  it('builds a play shell URL with normalized pathtodata', () => {
    const expectedPathToData = EMULATORJS_PINNED_PATH_TO_DATA;
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/Nintendo%20NES__pid-18/game.nes',
      gameTitle: 'Test Game',
      pathToData: PINNED_DATA_PATH,
      loaderIntegrity: VALID_LOADER_INTEGRITY,
    });

    const parsed = new URL(href);
    expect(parsed.origin + parsed.pathname).toBe('https://example.com/assets/emulatorjs/play.html');
    expect(parsed.searchParams.get('core')).toBe('nes');
    expect(parsed.searchParams.get('pathtodata')).toBe(expectedPathToData);
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
      loaderIntegrity: VALID_LOADER_INTEGRITY,
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
        loaderIntegrity: VALID_LOADER_INTEGRITY,
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
        loaderIntegrity: VALID_LOADER_INTEGRITY,
      })
    ).toThrow(/Invalid EmulatorJS pathToData URL/);
  });

  it('uses the pinned default when pathToData is empty', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/x.nes',
      pathToData: '   ',
      loaderIntegrity: VALID_LOADER_INTEGRITY,
    });
    expect(new URL(href).searchParams.get('pathtodata')).toBe(EMULATORJS_DEFAULT_PATH_TO_DATA);
  });

  it('normalizes pinned path by appending trailing slash when missing', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/x.nes',
      pathToData: PINNED_DATA_PATH.slice(0, -1),
      loaderIntegrity: VALID_LOADER_INTEGRITY,
    });

    expect(new URL(href).searchParams.get('pathtodata')).toBe(PINNED_DATA_PATH);
  });

  it('accepts another version directory under the trusted assets EmulatorJS base', () => {
    const altVersion =
      'https://thetigeregg.github.io/game-shelf-assets/third-party/emulatorjs/4.0.0/';
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/x.nes',
      pathToData: altVersion.slice(0, -1),
      loaderIntegrity: VALID_LOADER_INTEGRITY,
    });
    expect(new URL(href).searchParams.get('pathtodata')).toBe(altVersion);
  });

  it('rejects same-origin self-hosted EmulatorJS data paths', () => {
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'nes',
        romUrl: '/roms/x.nes',
        pathToData: 'https://example.com/assets/emulatorjs/data/',
        loaderIntegrity: VALID_LOADER_INTEGRITY,
      })
    ).toThrow(/Invalid EmulatorJS pathToData URL/);
  });

  it('rejects trusted-host paths outside the versioned EmulatorJS directory pattern', () => {
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'nes',
        romUrl: '/roms/x.nes',
        pathToData: 'https://thetigeregg.github.io/game-shelf-assets/third-party/other-tool/1.0.0/',
        loaderIntegrity: VALID_LOADER_INTEGRITY,
      })
    ).toThrow(/Invalid EmulatorJS pathToData URL/);
  });

  it('rejects non-absolute pathToData values', () => {
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'nes',
        romUrl: '/roms/x.nes',
        pathToData: '/game-shelf-assets/third-party/emulatorjs/4.2.3/',
        loaderIntegrity: VALID_LOADER_INTEGRITY,
      })
    ).toThrow(/Invalid EmulatorJS pathToData URL/);
  });

  it('throws when core is not a safe token', () => {
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'nes<script>',
        romUrl: '/roms/x.nes',
        pathToData: PINNED_DATA_PATH,
        loaderIntegrity: VALID_LOADER_INTEGRITY,
      })
    ).toThrow(/Invalid emulator core/);
  });

  it('throws when loader integrity is missing or blank', () => {
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'nes',
        romUrl: '/roms/x.nes',
        pathToData: PINNED_DATA_PATH,
        loaderIntegrity: undefined,
      })
    ).toThrow(/Missing loader integrity/);
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'nes',
        romUrl: '/roms/x.nes',
        pathToData: PINNED_DATA_PATH,
        loaderIntegrity: '',
      })
    ).toThrow(/Missing loader integrity/);
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'nes',
        romUrl: '/roms/x.nes',
        pathToData: PINNED_DATA_PATH,
        loaderIntegrity: '   ',
      })
    ).toThrow(/Missing loader integrity/);
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'nes',
        romUrl: '/roms/x.nes',
        pathToData: PINNED_DATA_PATH,
        loaderIntegrity: null,
      })
    ).toThrow(/Missing loader integrity/);
  });

  it('appends debug=1 when debug is true', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'nes',
      romUrl: '/roms/x.nes',
      pathToData: PINNED_DATA_PATH,
      debug: true,
      loaderIntegrity: VALID_LOADER_INTEGRITY,
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
      loaderIntegrity: VALID_LOADER_INTEGRITY,
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
      loaderIntegrity: VALID_LOADER_INTEGRITY,
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
        loaderIntegrity: VALID_LOADER_INTEGRITY,
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
      loaderIntegrity: VALID_LOADER_INTEGRITY,
    });
    expect(new URL(href).searchParams.get('biosbase')).toBe('/public-bios');
  });

  it('throws when biosBaseUrl contains dot segments (mirrors play shell)', () => {
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'psx',
        romUrl: '/roms/game.bin',
        pathToData: PINNED_DATA_PATH,
        biosUrl: 'https://example.com/bios/psx/scph1001.bin',
        biosBaseUrl: '/bios/../x',
        loaderIntegrity: VALID_LOADER_INTEGRITY,
      })
    ).toThrow(/Invalid EmulatorJS bios base path/);
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

  it('throws when loader_integrity is invalid', () => {
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'psx',
        romUrl: '/roms/game.bin',
        pathToData: PINNED_DATA_PATH,
        loaderIntegrity: 'md5-not-allowed',
      })
    ).toThrow(/Invalid loader integrity/);
  });

  it('adds rombase when using a non-default rom base path', () => {
    const href = buildEmulatorJsPlayShellUrl({
      origin: 'https://example.com',
      core: 'psx',
      romUrl: '/public-roms/game.bin',
      romBaseUrl: '/public-roms',
      pathToData: PINNED_DATA_PATH,
      loaderIntegrity: VALID_LOADER_INTEGRITY,
    });
    expect(new URL(href).searchParams.get('rombase')).toBe('/public-roms');
  });

  it('throws when rom URL is not under configured rom base', () => {
    expect(() =>
      buildEmulatorJsPlayShellUrl({
        origin: 'https://example.com',
        core: 'psx',
        romUrl: '/roms/game.bin',
        romBaseUrl: '/public-roms',
        pathToData: PINNED_DATA_PATH,
        loaderIntegrity: VALID_LOADER_INTEGRITY,
      })
    ).toThrow(/Invalid ROM URL/);
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

  it('throws when bios base path contains dot segments', () => {
    expect(() =>
      buildEmulatorJsBiosUrl('https://app.test', '/bios/../x', 'psx/scph1001.bin')
    ).toThrow(/Invalid EmulatorJS bios base path/);
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

  it('rejects URLs with embedded credentials', () => {
    expect(
      isAllowedEmulatorJsBiosUrl(
        'https://user:pass@app.test/bios/psx/scph1001.bin',
        'https://app.test'
      )
    ).toBe(false);
  });

  it('rejects dot-segments (including encoded) in BIOS paths', () => {
    expect(isAllowedEmulatorJsBiosUrl('https://app.test/bios/../x.bin', 'https://app.test')).toBe(
      false
    );
    expect(
      isAllowedEmulatorJsBiosUrl('https://app.test/bios/%2e%2e/x.bin', 'https://app.test')
    ).toBe(false);
    expect(
      isAllowedEmulatorJsBiosUrl('https://app.test/bios/%252e%252e/x.bin', 'https://app.test')
    ).toBe(false);
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

  it('rejects dot segments in configured bios base path', () => {
    expect(
      isAllowedEmulatorJsBiosUrl(
        'https://app.test/bios/psx/scph1001.bin',
        'https://app.test',
        '/bios/../x'
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

  it('rejects URLs with embedded credentials', () => {
    expect(isAllowedEmulatorJsRomUrl('https://user:pass@app.test/roms/x', 'https://app.test')).toBe(
      false
    );
  });

  it('rejects dot-segments (including encoded) in ROM paths', () => {
    expect(isAllowedEmulatorJsRomUrl('https://app.test/roms/../x.nes', 'https://app.test')).toBe(
      false
    );
    expect(
      isAllowedEmulatorJsRomUrl('https://app.test/roms/%2e%2e/x.nes', 'https://app.test')
    ).toBe(false);
    expect(
      isAllowedEmulatorJsRomUrl('https://app.test/roms/%252e%252e/x.nes', 'https://app.test')
    ).toBe(false);
  });

  it('supports custom rom base allowlist paths', () => {
    expect(
      isAllowedEmulatorJsRomUrl(
        'https://app.test/public-roms/folder/file.nes',
        'https://app.test',
        '/public-roms'
      )
    ).toBe(true);
    expect(
      isAllowedEmulatorJsRomUrl(
        'https://app.test/roms/folder/file.nes',
        'https://app.test',
        '/public-roms'
      )
    ).toBe(false);
  });
});

describe('isValidEmulatorJsLoaderIntegrity', () => {
  it('accepts valid SRI values', () => {
    expect(isValidEmulatorJsLoaderIntegrity('sha384-abcDEF123+/==')).toBe(true);
    expect(isValidEmulatorJsLoaderIntegrity(' sha512-abc123+/= ')).toBe(true);
  });

  it('rejects invalid SRI values', () => {
    expect(isValidEmulatorJsLoaderIntegrity('md5-abc123')).toBe(false);
    expect(isValidEmulatorJsLoaderIntegrity('sha384-')).toBe(false);
  });
});
