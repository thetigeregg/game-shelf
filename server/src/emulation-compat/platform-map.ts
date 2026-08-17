// Mirrors config/emulation-compat-platform-map.json, which drives compat-scraper's
// parser registry. Duplicated here as plain constants (like platform-ids.ts) rather
// than read from disk at runtime, since the server image doesn't ship config/.
export interface CompatPlatformConfig {
  emulator: string;
  displayName: string;
  sourceUrl: string;
}

export const COMPAT_PLATFORM_MAP: ReadonlyMap<number, CompatPlatformConfig> = new Map([
  [
    5,
    { emulator: 'dolphin', displayName: 'Wii', sourceUrl: 'https://www.dolphin-emu.org/compat/' },
  ],
  [
    21,
    {
      emulator: 'dolphin',
      displayName: 'GameCube',
      sourceUrl: 'https://www.dolphin-emu.org/compat/',
    },
  ],
]);

export function isCompatEligiblePlatform(platformIgdbId: number): boolean {
  return COMPAT_PLATFORM_MAP.has(platformIgdbId);
}

export function getCompatPlatformConfig(platformIgdbId: number): CompatPlatformConfig | null {
  return COMPAT_PLATFORM_MAP.get(platformIgdbId) ?? null;
}
