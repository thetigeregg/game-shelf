/**
 * Relative paths under the public BIOS mount (`biosBaseUrl`, default `/bios/`).
 *
 * EmulatorJS `EJS_biosUrl` is a normal file URL (docs example: `someFile.bin`). Single `.bin` /
 * `.rom` payloads work as-is; if the response is an archive, EmulatorJS may decompress it.
 * Filenames below are conventional — symlink or rename your dumps to match, or change this map.
 *
 * NES/Famicom FDS (`disksys.rom`, etc.) is not wired here: that core usually needs no BIOS for
 * cartridge games, and always requesting a missing FDS BIOS would break normal NES launches.
 * See EmulatorJS system docs (e.g. NES-Famicom) for optional add-on BIOS files.
 */
const EMULATOR_JS_CORE_TO_BIOS_RELATIVE_PATH = new Map<string, string>([
  ['psx', 'psx/scph1001.bin'],
  ['segaCD', 'segaCD/bios_CD_U.bin'],
  ['3do', '3do/panafz10.bin'],
  ['segaSaturn', 'segaSaturn/saturn_bios.bin'],
]);

/**
 * When non-null, in-browser play should pass this path (with `biosBaseUrl`) as `EJS_biosUrl`.
 * Cores that need per-title files (e.g. arcade) are omitted.
 */
export function resolveEmulatorJsBiosRelativePath(emulatorJsCore: string): string | null {
  const key = typeof emulatorJsCore === 'string' ? emulatorJsCore.trim() : '';
  if (key.length === 0) {
    return null;
  }

  const path = EMULATOR_JS_CORE_TO_BIOS_RELATIVE_PATH.get(key);
  return typeof path === 'string' && path.length > 0 ? path : null;
}
