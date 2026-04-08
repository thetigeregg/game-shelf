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
    expect(resolveEmulatorJsBiosRelativePath('nes', { romUrl: '/roms/x.nes' })).toBeNull();
    expect(resolveEmulatorJsBiosRelativePath('arcade')).toBeNull();
    expect(resolveEmulatorJsBiosRelativePath('')).toBeNull();
  });

  it('returns FDS BIOS path for nes when rom URL is an FDS disk image', () => {
    expect(
      resolveEmulatorJsBiosRelativePath('nes', {
        romUrl: 'https://app.test/roms/Nintendo%20NES__pid-18/game.fds',
      })
    ).toBe('nes/disksys.rom');
    expect(resolveEmulatorJsBiosRelativePath('nes', { romUrl: '/roms/folder/My%20Game.FDS' })).toBe(
      'nes/disksys.rom'
    );
  });
});
