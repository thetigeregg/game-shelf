/**
 * EmulatorJS distribution pinned to the `game-shelf-assets` GitHub Pages site.
 * The Angular app passes `EMULATORJS_DEFAULT_PATH_TO_DATA` through to the play shell as the
 * EmulatorJS `EJS_pathtodata` base URL (HTTPS). ROM/BIOS remain same-origin; only this static
 * bundle is loaded cross-origin with SRI (`EMULATORJS_PINNED_LOADER_INTEGRITY` for `loader.js`).
 */
export const EMULATORJS_REMOTE_BASE_PATH =
  'https://thetigeregg.github.io/game-shelf-assets/third-party/emulatorjs/';
export const EMULATORJS_RUNTIME_VERSION = '4.2.3';
export const EMULATORJS_PINNED_PATH_TO_DATA = `${EMULATORJS_REMOTE_BASE_PATH}${EMULATORJS_RUNTIME_VERSION}/`;
/** Default `EJS_pathtodata` base URL — versioned EmulatorJS files on `game-shelf-assets` (HTTPS only). */
export const EMULATORJS_DEFAULT_PATH_TO_DATA = EMULATORJS_PINNED_PATH_TO_DATA;
/** SRI metadata for `loader.js` at `EMULATORJS_DEFAULT_PATH_TO_DATA` (sha384-…). */
export const EMULATORJS_PINNED_LOADER_INTEGRITY =
  'sha384-CwARP2ej7UlPGk5E0IPt89lxjdb3t7zStyLR6PL7Sg4xzHSrvXh/R4vbb4PrSv6U';
