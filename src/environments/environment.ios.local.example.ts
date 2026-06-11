import {
  EMULATORJS_DEFAULT_PATH_TO_DATA,
  EMULATORJS_PINNED_LOADER_INTEGRITY,
} from '../app/core/config/emulatorjs.constants';

// Template for the Capacitor iOS dev build (`ng build --configuration ios-local`).
// Copy to `environment.ios.local.ts` (gitignored).
//
// Use the Mac LAN IP where Docker edge listens (:8080). The phone cannot reach
// 127.0.0.1 on your Mac. Edge serves /api, /manuals, /roms, and /bios on one host.
// Pair with the App Dev Xcode target (bundle id …gameshelf.dev) and
// GoogleService-Info.dev.plist from the dev Firebase project.

const BACKEND_ORIGIN = 'http://REPLACE_WITH_MAC_LAN_IP:8080';

export const environment = {
  production: false,
  gameApiBaseUrl: `${BACKEND_ORIGIN}/api`,
  manualsBaseUrl: `${BACKEND_ORIGIN}/manuals`,
  romsBaseUrl: `${BACKEND_ORIGIN}/roms`,
  biosBaseUrl: `${BACKEND_ORIGIN}/bios`,
  emulatorJsPathToData: EMULATORJS_DEFAULT_PATH_TO_DATA,
  emulatorJsLoaderIntegrity: EMULATORJS_PINNED_LOADER_INTEGRITY,
  emulatorJsDebug: true,
  featureFlags: {
    showMgcImport: false,
    e2eFixtures: false,
    recommendationsExploreEnabled: true,
    tasEnabled: false,
  },
};
