import {
  EMULATORJS_DEFAULT_PATH_TO_DATA,
  EMULATORJS_PINNED_LOADER_INTEGRITY,
} from '../app/core/config/emulatorjs.constants';

// Template for the Capacitor iOS production build (`ng build --configuration ios-prod`).
// Copy to `environment.ios.prod.ts` (gitignored).
//
// Relative URLs do not work on a device: they resolve against the Capacitor WebView
// origin (`capacitor://localhost`) instead of the deployed edge host.
// Pair with the prod App Xcode target and GoogleService-Info.prod.plist.

const BACKEND_ORIGIN = 'https://REPLACE_WITH_BACKEND_HOST';

export const environment = {
  production: true,
  gameApiBaseUrl: `${BACKEND_ORIGIN}/api`,
  manualsBaseUrl: `${BACKEND_ORIGIN}/manuals`,
  romsBaseUrl: `${BACKEND_ORIGIN}/roms`,
  biosBaseUrl: `${BACKEND_ORIGIN}/bios`,
  emulatorJsPathToData: EMULATORJS_DEFAULT_PATH_TO_DATA,
  emulatorJsLoaderIntegrity: EMULATORJS_PINNED_LOADER_INTEGRITY,
  emulatorJsDebug: false,
  featureFlags: {
    showMgcImport: false,
    e2eFixtures: false,
    recommendationsExploreEnabled: true,
    tasEnabled: false,
  },
};
