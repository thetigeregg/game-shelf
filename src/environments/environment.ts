import {
  EMULATORJS_DEFAULT_PATH_TO_DATA,
  EMULATORJS_PINNED_LOADER_INTEGRITY,
} from '../app/core/config/emulatorjs.constants';

// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  gameApiBaseUrl: '',
  manualsBaseUrl: '/manuals',
  romsBaseUrl: '/roms',
  /** Public BIOS mount (same origin); used when a core requires `EJS_biosUrl`. */
  biosBaseUrl: '/bios',
  /** HTTPS base URL for EmulatorJS `EJS_pathtodata` (GitHub Pages `game-shelf-assets` bundle only). */
  emulatorJsPathToData: EMULATORJS_DEFAULT_PATH_TO_DATA,
  /** SRI for cross-origin `loader.js` under `emulatorJsPathToData` (e.g. `sha384-...`). */
  emulatorJsLoaderIntegrity: EMULATORJS_PINNED_LOADER_INTEGRITY,
  /** Enables EmulatorJS `EJS_DEBUG_XX` in the play iframe (verbose console, unminified scripts). */
  emulatorJsDebug: true,
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },
  firebaseVapidKey: '',
  featureFlags: {
    showMgcImport: false,
    e2eFixtures: false,
    recommendationsExploreEnabled: true,
    tasEnabled: false,
  },
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
