import {
  EMULATORJS_DEFAULT_PATH_TO_DATA,
  EMULATORJS_PINNED_LOADER_INTEGRITY,
} from '../app/core/config/emulatorjs.constants';

export const environment = {
  production: false,
  gameApiBaseUrl: '',
  manualsBaseUrl: '/manuals',
  romsBaseUrl: '/roms',
  biosBaseUrl: '/bios',
  /** HTTPS base URL for EmulatorJS `EJS_pathtodata` (GitHub Pages `game-shelf-assets` distribution only). */
  emulatorJsPathToData: EMULATORJS_DEFAULT_PATH_TO_DATA,
  /** SRI hash for cross-origin `loader.js` at `emulatorJsPathToData` (must match the pinned build). */
  emulatorJsLoaderIntegrity: EMULATORJS_PINNED_LOADER_INTEGRITY,
  /** When true, sets EmulatorJS `EJS_DEBUG_XX` in the play iframe (see `play.html` `debug=1`). */
  emulatorJsDebug: false,
  featureFlags: {
    showMgcImport: false,
    e2eFixtures: false,
    recommendationsExploreEnabled: true,
    tasEnabled: false,
  },
};
