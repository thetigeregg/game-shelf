import { EMULATORJS_PINNED_PATH_TO_DATA } from '../app/core/config/emulatorjs.constants';

export const environment = {
  production: true,
  gameApiBaseUrl: '/api',
  manualsBaseUrl: '/manuals',
  romsBaseUrl: '/roms',
  biosBaseUrl: '/bios',
  emulatorJsPathToData: EMULATORJS_PINNED_PATH_TO_DATA,
  emulatorJsLoaderIntegrity:
    'sha384-CwARP2ej7UlPGk5E0IPt89lxjdb3t7zStyLR6PL7Sg4xzHSrvXh/R4vbb4PrSv6U',
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
