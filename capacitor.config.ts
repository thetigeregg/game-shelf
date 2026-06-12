import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.thetigeregg.gameshelf',
  appName: 'GameShelf',
  webDir: 'www/browser',
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    FirebaseMessaging: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchAutoHide: false,
      launchFadeOutDuration: 300,
    },
  },
};

export default config;
