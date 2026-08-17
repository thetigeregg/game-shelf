import type { EmulationCompatStatus } from '../../../shared/emulation-compat-status.mjs';

// Mirrors config/emulation-compat-platform-map.json, which drives compat-scraper's
// parser registry. Duplicated here as plain constants (like platform-ids.ts) rather
// than read from disk at runtime, since the server image doesn't ship config/.
export interface CompatPlatformConfig {
  emulator: string;
  displayName: string;
  sourceUrl: string;
  // The best status this emulator's compatibility list can report (e.g. Dolphin's
  // ceiling is "perfect"; an emulator with no perfect tier might cap out at "playable").
  // Games already at this status are stable and skipped on refresh — they can't improve.
  bestStatus: EmulationCompatStatus;
}

export const COMPAT_PLATFORM_MAP: ReadonlyMap<number, CompatPlatformConfig> = new Map([
  [
    5,
    {
      emulator: 'dolphin',
      displayName: 'Wii',
      sourceUrl: 'https://www.dolphin-emu.org/compat/',
      bestStatus: 'perfect',
    },
  ],
  [
    21,
    {
      emulator: 'dolphin',
      displayName: 'GameCube',
      sourceUrl: 'https://www.dolphin-emu.org/compat/',
      bestStatus: 'perfect',
    },
  ],
  [
    8,
    {
      emulator: 'pcsx2',
      displayName: 'PlayStation 2',
      sourceUrl: 'https://pcsx2.net/compat/',
      bestStatus: 'perfect',
    },
  ],
  [
    11,
    {
      emulator: 'xemu',
      displayName: 'Xbox',
      sourceUrl: 'https://xemu.app/compat.json',
      bestStatus: 'perfect',
    },
  ],
  [
    12,
    {
      emulator: 'xenia',
      displayName: 'Xbox 360',
      sourceUrl: 'https://xenia-manager.github.io/database/data/game-compatibility/canary.json',
      bestStatus: 'playable',
    },
  ],
  [
    9,
    {
      emulator: 'rpcs3',
      displayName: 'PlayStation 3',
      sourceUrl: 'https://rpcs3.net/compatibility',
      bestStatus: 'playable',
    },
  ],
]);

export function isCompatEligiblePlatform(platformIgdbId: number): boolean {
  return COMPAT_PLATFORM_MAP.has(platformIgdbId);
}

export function getCompatPlatformConfig(platformIgdbId: number): CompatPlatformConfig | null {
  return COMPAT_PLATFORM_MAP.get(platformIgdbId) ?? null;
}
