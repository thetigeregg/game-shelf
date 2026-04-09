import { describe, expect, it } from 'vitest';
import {
  DOCUMENTED_EMULATOR_JS_CORES,
  IGDB_TO_DOCUMENTED_EMULATOR_JS_CORE,
  isDocumentedEmulatorJsCore,
  resolveEmulatorJsCore,
} from './emulatorjs-platform-map';

describe('resolveEmulatorJsCore', () => {
  it('returns cores for supported IGDB platform IDs', () => {
    expect(resolveEmulatorJsCore(18)).toBe('nes');
    expect(resolveEmulatorJsCore(19)).toBe('snes');
    expect(resolveEmulatorJsCore(24)).toBe('gba');
    expect(resolveEmulatorJsCore(7)).toBe('psx');
    expect(resolveEmulatorJsCore(61)).toBe('lynx');
    expect(resolveEmulatorJsCore(68)).toBe('coleco');
  });

  it('returns null for unsupported or modern platforms', () => {
    expect(resolveEmulatorJsCore(5)).toBeNull();
    expect(resolveEmulatorJsCore(21)).toBeNull();
    expect(resolveEmulatorJsCore(8)).toBeNull();
    expect(resolveEmulatorJsCore(130)).toBeNull();
  });

  it('returns null for invalid IDs', () => {
    expect(resolveEmulatorJsCore(0)).toBeNull();
    expect(resolveEmulatorJsCore(-1)).toBeNull();
  });
});

describe('EmulatorJS documented cores (https://emulatorjs.org/docs4devs/cores)', () => {
  it('maps every supported IGDB platform to a documented EJS_core', () => {
    const documented = new Set(DOCUMENTED_EMULATOR_JS_CORES);

    for (const [, core] of IGDB_TO_DOCUMENTED_EMULATOR_JS_CORE) {
      expect(documented.has(core), `core "${core}" must be in DOCUMENTED_EMULATOR_JS_CORES`).toBe(
        true
      );
    }
  });

  it('lists each IGDB platform at most once', () => {
    const seen = new Set<number>();
    for (const [id] of IGDB_TO_DOCUMENTED_EMULATOR_JS_CORE) {
      expect(seen.has(id), `duplicate IGDB platform id: ${String(id)}`).toBe(false);
      seen.add(id);
    }
  });

  it('exposes isDocumentedEmulatorJsCore for known tokens', () => {
    expect(isDocumentedEmulatorJsCore('nes')).toBe(true);
    expect(isDocumentedEmulatorJsCore('not-a-core')).toBe(false);
  });
});
