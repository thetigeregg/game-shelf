import { describe, expect, it } from 'vitest';
import { resolveEmulatorJsBiosRelativePath } from './emulatorjs-bios-path';

describe('resolveEmulatorJsBiosRelativePath', () => {
  it('returns conventional BIOS file paths for cores that need them', () => {
    expect(resolveEmulatorJsBiosRelativePath('psx')).toBe('psx/scph1001.bin');
    expect(resolveEmulatorJsBiosRelativePath('segaCD')).toBe('segaCD/bios_CD_U.bin');
    expect(resolveEmulatorJsBiosRelativePath('3do')).toBe('3do/panafz10.bin');
    expect(resolveEmulatorJsBiosRelativePath('segaSaturn')).toBe('segaSaturn/saturn_bios.bin');
  });

  it('returns null for cores without a bundled BIOS convention', () => {
    expect(resolveEmulatorJsBiosRelativePath('nes')).toBeNull();
    expect(resolveEmulatorJsBiosRelativePath('arcade')).toBeNull();
    expect(resolveEmulatorJsBiosRelativePath('')).toBeNull();
  });
});
