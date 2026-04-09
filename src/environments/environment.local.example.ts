import { EMULATORJS_DEFAULT_PATH_TO_DATA } from '../app/core/config/emulatorjs.constants';

export const environment = {
  production: false,
  gameApiBaseUrl: '',
  manualsBaseUrl: '/manuals',
  romsBaseUrl: '/roms',
  biosBaseUrl: '/bios',
  /** HTTPS base URL for EmulatorJS `EJS_pathtodata` (GitHub Pages `game-shelf-assets` distribution only). */
  emulatorJsPathToData: EMULATORJS_DEFAULT_PATH_TO_DATA,
  /** SRI hash for cross-origin `loader.js` at `emulatorJsPathToData` (must match the pinned build). */
  emulatorJsLoaderIntegrity:
    'sha384-CwARP2ej7UlPGk5E0IPt89lxjdb3t7zStyLR6PL7Sg4xzHSrvXh/R4vbb4PrSv6U',
  /** When true, sets EmulatorJS `EJS_DEBUG_XX` in the play iframe (see `play.html` `debug=1`). */
  emulatorJsDebug: false,
  featureFlags: {
    showMgcImport: false,
    e2eFixtures: false,
    recommendationsExploreEnabled: true,
    tasEnabled: false,
  },
  firebase: {
    apiKey: 'REPLACE_WITH_FIREBASE_API_KEY',
    authDomain: 'REPLACE_WITH_FIREBASE_AUTH_DOMAIN',
    projectId: 'REPLACE_WITH_FIREBASE_PROJECT_ID',
    storageBucket: 'REPLACE_WITH_FIREBASE_STORAGE_BUCKET',
    messagingSenderId: 'REPLACE_WITH_FIREBASE_MESSAGING_SENDER_ID',
    appId: 'REPLACE_WITH_FIREBASE_APP_ID',
  },
  firebaseVapidKey: 'REPLACE_WITH_FIREBASE_VAPID_KEY',
};
