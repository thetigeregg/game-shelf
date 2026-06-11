import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.thetigeregg.gameshelf',
  appName: 'GameShelf',
  webDir: 'www/browser',
  plugins: {
    FirebaseMessaging: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  experimental: {
    ios: {
      spm: {
        packageOptions: {
          '@capacitor-firebase/<package-name>': {
            symlink: true,
          },
        },
      },
    },
  },
};

export default config;
