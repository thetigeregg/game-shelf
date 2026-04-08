export const environment = {
  production: true,
  gameApiBaseUrl: '/api',
  manualsBaseUrl: '/manuals',
  romsBaseUrl: '/roms',
  emulatorJsPathToData: 'https://cdn.emulatorjs.org/stable/data/',
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
