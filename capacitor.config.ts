import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { CapacitorConfig } from '@capacitor/cli';

const LIVE_UPDATE_PUBLIC_KEY_PATH = resolve(process.cwd(), 'config/ios-live-update-public.pem');

function readLiveUpdatePublicKey(): string {
  return readFileSync(LIVE_UPDATE_PUBLIC_KEY_PATH, 'utf8').trim();
}

const config: CapacitorConfig = {
  appId: 'io.github.thetigeregg.gameshelf',
  appName: 'GameShelf',
  webDir: 'www/browser',
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
    },
    FirebaseMessaging: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchAutoHide: false,
      launchFadeOutDuration: 300,
    },
    LiveUpdate: {
      autoUpdateStrategy: 'none',
      readyTimeout: 10000,
      publicKey: readLiveUpdatePublicKey(),
    },
  },
};

export default config;
