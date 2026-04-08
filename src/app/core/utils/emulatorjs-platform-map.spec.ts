import { describe, expect, it } from 'vitest';
import { resolveEmulatorJsCore } from './emulatorjs-platform-map';

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
