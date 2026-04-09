import { describe, expect, it } from 'vitest';
import { resolveEmulatorJsBiosRelativePath } from './emulatorjs-bios-path';

describe('resolveEmulatorJsBiosRelativePath', () => {
  it('returns melonDS BIOS zip path for nds', () => {
    expect(resolveEmulatorJsBiosRelativePath('nds')).toBe('nds/melonds-bios.zip');
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
