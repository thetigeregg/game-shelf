/**
 * Relative paths under the public BIOS mount (`biosBaseUrl`, default `/bios/`).
 *
 * EmulatorJS `EJS_biosUrl` is a normal file URL (docs example: `someFile.bin`). Single `.bin` /
 * `.rom` payloads work as-is; if the response is an archive, EmulatorJS may decompress it.
 * Filenames below are conventional — symlink or rename your dumps to match, or change this map.
 *
 * Famicom Disk System: place `disksys.rom` at `nes/disksys.rom`. It is only requested when the
 * launch ROM path ends with `.fds`, so cartridge `.nes` games do not trigger a BIOS fetch.
 *
 * Atari Lynx and ColecoVision require BIOS for all titles (`lynxboot.img`, `colecovision.rom`).
 */
const EMULATOR_JS_CORE_TO_BIOS_RELATIVE_PATH = new Map<string, string>([
  ['psx', 'psx/scph1001.bin'],
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
