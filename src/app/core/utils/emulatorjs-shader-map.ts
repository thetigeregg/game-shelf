/**
 * Default RetroArch-style shader presets for EmulatorJS `EJS_defaultOptions.shader`, keyed by
 * canonical IGDB platform id. Values are passed to EmulatorJS as-is.
 */
const IGDB_PLATFORM_ID_TO_SHADER = new Map<number, string | null>([
  // 2nd/3rd gen home consoles → crt-lottes (phosphor, older consumer TV)
  [18, 'crt-lottes'],
  [59, 'crt-lottes'],
  [68, 'crt-lottes'],
  [64, 'crt-lottes'],
  [84, 'crt-lottes'],

  // 4th gen home consoles → crt-aperture (aperture grille / Trinitron era)
  [19, 'crt-aperture.glslp'],
  [58, 'crt-aperture.glslp'],
  [29, 'crt-aperture.glslp'],
  [30, 'crt-aperture.glslp'],
  [482, 'crt-aperture.glslp'],
  [78, 'crt-aperture.glslp'],

  // 5th gen home consoles → crt-geom (curved, high-fidelity)
  [7, 'crt-geom.glslp'],
  [32, 'crt-geom.glslp'],
  [50, 'crt-geom.glslp'],
  [4, 'crt-geom.glslp'],
  [416, 'crt-geom.glslp'],

  // Arcade & PC Engine → crt-easymode (clean scanlines)
  [79, 'crt-easymode.glslp'],
  [80, 'crt-easymode.glslp'],
  [86, 'crt-easymode.glslp'],
  [150, 'crt-easymode.glslp'],

  // Edge cases → crt-caligari (softer, ambiguous display context)
  [62, 'crt-caligari'],
  [410, 'crt-caligari'],

  // Handheld / LCD → no shader
  [20, null],
  [22, null],
  [24, null],
  [33, null],
  [35, null],
  [38, null],
  [57, null],
  [61, null],
  [87, null],
  [120, null],
  [123, null],
]);

export function resolveEmulatorJsShader(canonicalPlatformIgdbId: number): string | null {
  if (!Number.isInteger(canonicalPlatformIgdbId) || canonicalPlatformIgdbId <= 0) {
    return null;
  }

  if (!IGDB_PLATFORM_ID_TO_SHADER.has(canonicalPlatformIgdbId)) {
    return null;
  }

  const raw = IGDB_PLATFORM_ID_TO_SHADER.get(canonicalPlatformIgdbId);
  if (raw === undefined || raw === null) {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}
