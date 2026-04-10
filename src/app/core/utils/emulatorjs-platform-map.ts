/**
 * `EJS_core` values listed under “Available Cores” on the official EmulatorJS dev docs.
 * Source of truth: https://emulatorjs.org/docs4devs/cores
 *
 * IGDB → core mappings below only use cores from that list. Game detail ROM UI is gated on
 * `resolveEmulatorJsCore` returning non-null. Manual PDF shortcuts use a separate whitelist in
 * `GameListComponent`.
 *
 * Operator-facing table (IGDB id, `__pid-` suffix, BIOS): `docs/nas-deployment.md`
 * (**EmulatorJS: supported IGDB platforms (in-browser)**).
 */
export const DOCUMENTED_EMULATOR_JS_CORES = [
  '3do',
  'a5200',
  'amiga',
  'arcade',
  'atari2600',
  'atari7800',
  'c128',
  'c64',
  'coleco',
  'dos',
  'gb',
  'gba',
  'jaguar',
  'lynx',
  'mame2003',
  'n64',
  'nds',
  'nes',
  'ngp',
  'pce',
  'pcfx',
  'pet',
  'plus4',
  'psx',
  'psp',
  'sega32x',
  'segaCD',
  'segaGG',
  'segaMD',
  'segaMS',
  'segaSaturn',
  'snes',
  'vb',
  'vic20',
  'ws',
] as const;

export type DocumentedEmulatorJsCore = (typeof DOCUMENTED_EMULATOR_JS_CORES)[number];

const DOCUMENTED_EMULATOR_JS_CORE_SET = new Set<string>(DOCUMENTED_EMULATOR_JS_CORES);

export function isDocumentedEmulatorJsCore(value: string): value is DocumentedEmulatorJsCore {
  return DOCUMENTED_EMULATOR_JS_CORE_SET.has(value);
}

/**
 * IGDB platform id → documented `EJS_core`. Only includes platforms present in
 * `src/app/core/data/platform-catalog.ts` where the mapping is unambiguous.
 *
 * Notes:
 * - CD-i: docs list `same_cdi` under the `arcade` core.
 * - Neo Geo CD / Hyper Neo Geo 64: launched via the `arcade` core (FBNeo / MAME family).
 * - 64DD: no separate core; N64 hardware family → `n64`.
 * - Satellaview: SNES satellite content → `snes`.
 */
export const IGDB_TO_DOCUMENTED_EMULATOR_JS_CORE: ReadonlyArray<
  readonly [number, DocumentedEmulatorJsCore]
> = [
  [4, 'n64'],
  [7, 'psx'],
  [13, 'dos'],
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
  [51, 'nes'],
  [52, 'arcade'],
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
  [99, 'nes'],
  [117, 'arcade'],
  [119, 'ngp'],
  [120, 'ngp'],
  [123, 'ws'],
  [124, 'ws'],
  [128, 'pce'],
  [135, 'arcade'],
  [136, 'arcade'],
  [150, 'pce'],
  [274, 'pcfx'],
  [306, 'snes'],
  [410, 'jaguar'],
  [416, 'n64'],
  [482, 'sega32x'],
];

const IGDB_PLATFORM_ID_TO_EMULATOR_JS_CORE = new Map<number, DocumentedEmulatorJsCore>(
  IGDB_TO_DOCUMENTED_EMULATOR_JS_CORE
);

export function resolveEmulatorJsCore(
  canonicalPlatformIgdbId: number
): DocumentedEmulatorJsCore | null {
  if (!Number.isInteger(canonicalPlatformIgdbId) || canonicalPlatformIgdbId <= 0) {
    return null;
  }

  const core = IGDB_PLATFORM_ID_TO_EMULATOR_JS_CORE.get(canonicalPlatformIgdbId);
  return typeof core === 'string' && core.length > 0 ? core : null;
}
