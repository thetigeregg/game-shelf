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
  /** Default EmulatorJS runtime path; app also permits same-origin `/assets/emulatorjs/data/`. */
  emulatorJsPathToData:
    'https://thetigeregg.github.io/game-shelf-assets/third-party/emulatorjs/4.2.3/',
  /** Optional SRI hash for `loader.js` at the configured `emulatorJsPathToData` (format: `sha384-...`). */
  emulatorJsLoaderIntegrity:
    'sha384-CwARP2ej7UlPGk5E0IPt89lxjdb3t7zStyLR6PL7Sg4xzHSrvXh/R4vbb4PrSv6U',
  /** Enables EmulatorJS `EJS_DEBUG_XX` (verbose console + unminified scripts) in the play iframe. */
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
