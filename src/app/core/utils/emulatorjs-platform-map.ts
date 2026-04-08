/**
 * Maps canonical IGDB platform IDs to EmulatorJS `EJS_core` values.
 * See https://emulatorjs.org/docs/systems and https://emulatorjs.org/docs4devs/cores
 *
 * Platforms in the manual/ROM shortcut whitelist that are not supported in-browser
 * (e.g. Wii, GameCube, PS2, Xbox) return `null`.
 */
const IGDB_PLATFORM_ID_TO_EMULATOR_JS_CORE = new Map<number, string>([
  [4, 'n64'],
  [7, 'psx'],
  [18, 'nes'],
  [19, 'snes'],
  [20, 'nds'],
  [22, 'gb'],
  [24, 'gba'],
  [29, 'segaMD'],
  [30, 'sega32x'],
  [32, 'segaSaturn'],
  [33, 'gb'],
  [35, 'segaGG'],
  [38, 'psp'],
  [50, '3do'],
  [57, 'ws'],
  [58, 'snes'],
  [59, 'atari2600'],
  [61, 'lynx'],
  [62, 'jaguar'],
  [64, 'segaMS'],
  [68, 'coleco'],
  [78, 'segaCD'],
  [79, 'arcade'],
  [80, 'arcade'],
  [84, 'segaMS'],
  [86, 'pce'],
  [87, 'vb'],
  [120, 'ngp'],
  [123, 'ws'],
  [150, 'pce'],
  [410, 'jaguar'],
  [416, 'n64'],
  [482, 'sega32x'],
]);

export function resolveEmulatorJsCore(canonicalPlatformIgdbId: number): string | null {
  if (!Number.isInteger(canonicalPlatformIgdbId) || canonicalPlatformIgdbId <= 0) {
    return null;
  }

  const core = IGDB_PLATFORM_ID_TO_EMULATOR_JS_CORE.get(canonicalPlatformIgdbId);
  return typeof core === 'string' && core.length > 0 ? core : null;
}
