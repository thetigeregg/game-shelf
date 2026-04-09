import {
  EMULATORJS_DEFAULT_PATH_TO_DATA,
  EMULATORJS_PINNED_LOADER_INTEGRITY,
} from '../app/core/config/emulatorjs.constants';

export const environment = {
  production: true,
  gameApiBaseUrl: '/api',
  manualsBaseUrl: '/manuals',
  romsBaseUrl: '/roms',
  biosBaseUrl: '/bios',
  emulatorJsPathToData: EMULATORJS_DEFAULT_PATH_TO_DATA,
  emulatorJsLoaderIntegrity: EMULATORJS_PINNED_LOADER_INTEGRITY,
  emulatorJsDebug: false,
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
