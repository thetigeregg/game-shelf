import { describe, expect, it } from 'vitest';
import { resolveEmulatorJsBiosRelativePath } from './emulatorjs-bios-path';

describe('resolveEmulatorJsBiosRelativePath', () => {
  it('returns BIOS zip paths for cores with multi-file EmulatorJS BIOS tables', () => {
    expect(resolveEmulatorJsBiosRelativePath('psx')).toBe('psx/psx-bios.zip');
    expect(resolveEmulatorJsBiosRelativePath('nds')).toBe('nds/nds-bios.zip');
    expect(resolveEmulatorJsBiosRelativePath('segaCD')).toBe('segaCD/segaCD-bios.zip');
    expect(resolveEmulatorJsBiosRelativePath('3do')).toBe('3do/3do-bios.zip');
  });

  it('returns single-file BIOS paths where EmulatorJS documents one file', () => {
    expect(resolveEmulatorJsBiosRelativePath('segaSaturn')).toBe('segaSaturn/saturn_bios.bin');
    expect(resolveEmulatorJsBiosRelativePath('lynx')).toBe('lynx/lynxboot.img');
    expect(resolveEmulatorJsBiosRelativePath('coleco')).toBe('coleco/colecovision.rom');
  });

  it('returns null for nes when ROM is not FDS', () => {
    expect(resolveEmulatorJsBiosRelativePath('nes', { romUrl: '/roms/x/game.nes' })).toBeNull();
  });

  it('returns FDS BIOS path for nes when ROM ends with .fds', () => {
    expect(resolveEmulatorJsBiosRelativePath('nes', { romUrl: '/roms/x/game.fds' })).toBe(
      'nes/disksys.rom'
    );
  });
});
