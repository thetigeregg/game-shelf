/**
 * Relative paths under the public BIOS mount (`biosBaseUrl`, default `/bios/`).
 *
 * EmulatorJS exposes a single `EJS_biosUrl`. Policy and the full supported-platform / BIOS
 * matrix live in `docs/nas-deployment.md` (**BIOS files**, **EmulatorJS: supported IGDB platforms**).
 * `EJS_core` tokens follow https://emulatorjs.org/docs4devs/cores.
 *
 * - If the [EmulatorJS system doc](https://emulatorjs.org/docs/systems/) for that core lists
 *   **more than one distinct BIOS file name** (regions, hardware variants, or required sets),
 *   use **one zip** at `<EJS_core>/<EJS_core>-bios.zip` with those names at the **archive root**
 *   (include every member you rely on; exact spellings must match the doc).
 * - If the upstream doc is effectively **one** BIOS file for the platform, use that **single
 *   file** at the path below (no zip).
 *
 * Famicom Disk System: `nes/disksys.rom` only when the ROM path ends with `.fds`.
 */
const EMULATOR_JS_CORE_TO_BIOS_RELATIVE_PATH = new Map<string, string>([
  ['3do', '3do/3do-bios.zip'],
  ['coleco', 'coleco/colecovision.rom'],
  ['gb', 'gb/gb-bios.zip'],
  ['gba', 'gba/gba-bios.zip'],
  ['lynx', 'lynx/lynxboot.img'],
  ['nds', 'nds/nds-bios.zip'],
  ['psx', 'psx/psx-bios.zip'],
  ['segaCD', 'segaCD/segaCD-bios.zip'],
  ['segaGG', 'segaGG/bios.gg'],
  ['segaMD', 'segaMD/bios_MD.bin'],
  ['segaMS', 'segaMS/segaMS-bios.zip'],
  ['segaSaturn', 'segaSaturn/saturn_bios.bin'],
  ['snes', 'snes/snes-bios.zip'],
]);

const NES_FDS_DISK_IMAGE_SUFFIX = '.fds';

export interface ResolveEmulatorJsBiosRelativePathOptions {
  /** Absolute or same-origin ROM URL; used to detect FDS (`.fds`) for `nes` only. */
  romUrl?: string | null;
  /** Canonical IGDB platform id (used for platform-specific BIOS decisions on shared cores). */
  canonicalPlatformIgdbId?: number | null;
}

function romUrlPathnameEndsWithFds(romUrl: string): boolean {
  const trimmed = romUrl.trim();
  if (trimmed.length === 0) {
    return false;
  }

  try {
    const pathname = new URL(trimmed).pathname;
    return pathname.toLowerCase().endsWith(NES_FDS_DISK_IMAGE_SUFFIX);
  } catch {
    const withoutQuery = trimmed.split('?')[0] ?? trimmed;
    return withoutQuery.toLowerCase().endsWith(NES_FDS_DISK_IMAGE_SUFFIX);
  }
}

/**
 * When non-null, in-browser play should pass this path (with `biosBaseUrl`) as `EJS_biosUrl`.
 * Cores that need per-title files (e.g. arcade) are omitted.
 */
export function resolveEmulatorJsBiosRelativePath(
  emulatorJsCore: string,
  options?: ResolveEmulatorJsBiosRelativePathOptions
): string | null {
  const key = typeof emulatorJsCore === 'string' ? emulatorJsCore.trim() : '';
  if (key.length === 0) {
    return null;
  }

  if (key === 'nes') {
    const romUrl = typeof options?.romUrl === 'string' ? options.romUrl : '';
    if (romUrlPathnameEndsWithFds(romUrl)) {
      return 'nes/disksys.rom';
    }
    return null;
  }

  // `pce` is used for both HuCard (`pid 86`) and CD (`pid 150`) in platform mapping.
  // For CD titles we follow the multi-file zip convention (`<core>/<core>-bios.zip`).
  if (key === 'pce') {
    return options?.canonicalPlatformIgdbId === 150 ? 'pce/pce-bios.zip' : null;
  }

  const path = EMULATOR_JS_CORE_TO_BIOS_RELATIVE_PATH.get(key);
  return typeof path === 'string' && path.length > 0 ? path : null;
}
