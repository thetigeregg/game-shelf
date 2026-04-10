export const environment = {
  production: true,
  gameApiBaseUrl: '/api',
  manualsBaseUrl: '/manuals',
  romsBaseUrl: '/roms',
  biosBaseUrl: '/bios',
  emulatorJsPathToData:
    'https://thetigeregg.github.io/game-shelf-assets/third-party/emulatorjs/4.2.3/',
  emulatorJsLoaderIntegrity:
    'sha384-CwARP2ej7UlPGk5E0IPt89lxjdb3t7zStyLR6PL7Sg4xzHSrvXh/R4vbb4PrSv6U',
  emulatorJsDebug: false,
  firebase: {
    apiKey: 'ci-placeholder',
    authDomain: 'ci-placeholder',
    projectId: 'ci-placeholder',
    storageBucket: 'ci-placeholder',
    messagingSenderId: 'ci-placeholder',
    appId: 'ci-placeholder',
  },
  firebaseVapidKey: 'ci-placeholder',
  featureFlags: {
    showMgcImport: false,
    e2eFixtures: false,
    recommendationsExploreEnabled: true,
    tasEnabled: false,
  },
};
