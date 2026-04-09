/**
 * Relative paths under the public BIOS mount (`biosBaseUrl`, default `/bios/`).
 *
 * EmulatorJS `EJS_biosUrl` is a single URL. **One file per path** for cores that only need one
 * dump (`.bin` / `.rom` / `.img` as listed). **Multi-file BIOS:** pack every required blob into
 * **one zip** at the path below; use exact inner filenames from EmulatorJS system docs. Zip path
 * convention for multi-file cores: `<subdir>/<identifier>-bios.zip` (see `docs/nas-deployment.md`).
 *
 * Filenames below are conventional — symlink or rename your dumps to match, or change this map.
 *
 * Famicom Disk System: place `disksys.rom` at `nes/disksys.rom`. It is only requested when the
 * launch ROM path ends with `.fds`, so cartridge `.nes` games do not trigger a BIOS fetch.
 *
 * Atari Lynx and ColecoVision require BIOS for all titles (`lynxboot.img`, `colecovision.rom`).
 *
 * Nintendo DS (`nds` / melonDS): zip at `nds/melonds-bios.zip` with `bios7.bin`, `bios9.bin`,
 * `firmware.bin` at archive root (EmulatorJS Nintendo DS docs).
 */
const EMULATOR_JS_CORE_TO_BIOS_RELATIVE_PATH = new Map<string, string>([
  ['psx', 'psx/scph1001.bin'],
  ['nds', 'nds/melonds-bios.zip'],
  ['segaCD', 'segaCD/bios_CD_U.bin'],
  ['3do', '3do/panafz10.bin'],
  ['segaSaturn', 'segaSaturn/saturn_bios.bin'],
  ['lynx', 'lynx/lynxboot.img'],
  ['coleco', 'coleco/colecovision.rom'],
]);

const NES_FDS_DISK_IMAGE_SUFFIX = '.fds';

export interface ResolveEmulatorJsBiosRelativePathOptions {
  /** Absolute or same-origin ROM URL; used to detect FDS (`.fds`) for `nes` only. */
  romUrl?: string | null;
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

  const path = EMULATOR_JS_CORE_TO_BIOS_RELATIVE_PATH.get(key);
  return typeof path === 'string' && path.length > 0 ? path : null;
}
