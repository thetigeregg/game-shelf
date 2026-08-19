// Keep in sync with config/emulation-compat-platform-map.json and
// server/src/emulation-compat/platform-map.ts — these are the platforms with
// real per-title emulator compatibility tracking.
const COMPAT_TRACKED_PLATFORM_IGDB_IDS: ReadonlySet<number> = new Set([
  5, // Wii
  21, // GameCube
  8, // PlayStation 2
  11, // Xbox
  12, // Xbox 360
  9, // PlayStation 3
  41, // Wii U
  46, // PlayStation Vita
  37, // 3DS
]);

export function isCompatTrackedPlatform(platformIgdbId: number | null | undefined): boolean {
  return typeof platformIgdbId === 'number' && COMPAT_TRACKED_PLATFORM_IGDB_IDS.has(platformIgdbId);
}
