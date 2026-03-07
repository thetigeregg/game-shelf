const defaultConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};
// Emergency fallback only when runtime config cannot be loaded.
// Keep this in sync with DEFAULT_FIREBASE_CDN_VERSION in
// scripts/generate-runtime-config.mjs.
const DEFAULT_FIREBASE_CDN_VERSION = '11.10.0';

function normalizeRuntimeString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

const runtimeBootstrap = (() => {
  try {
    importScripts('/assets/runtime-config.js');
  } catch {
    // Runtime config is optional in development/fallback contexts.
  }

  try {
    const runtime = globalThis.__GAME_SHELF_RUNTIME_CONFIG__;
    const firebaseConfig = runtime?.firebase;
    if (!firebaseConfig || typeof firebaseConfig !== 'object') {
      return {
        firebaseConfig: defaultConfig,
        firebaseCdnVersion: normalizeRuntimeString(runtime?.firebaseCdnVersion)
      };
    }

    return {
      firebaseConfig: {
        apiKey: typeof firebaseConfig.apiKey === 'string' ? firebaseConfig.apiKey : '',
        authDomain: typeof firebaseConfig.authDomain === 'string' ? firebaseConfig.authDomain : '',
        projectId: typeof firebaseConfig.projectId === 'string' ? firebaseConfig.projectId : '',
        storageBucket:
          typeof firebaseConfig.storageBucket === 'string' ? firebaseConfig.storageBucket : '',
        messagingSenderId:
          typeof firebaseConfig.messagingSenderId === 'string'
            ? firebaseConfig.messagingSenderId
            : '',
        appId: typeof firebaseConfig.appId === 'string' ? firebaseConfig.appId : ''
      },
      firebaseCdnVersion: normalizeRuntimeString(runtime?.firebaseCdnVersion)
    };
  } catch {
    return {
      firebaseConfig: defaultConfig,
      firebaseCdnVersion: null
    };
  }
})();

const runtimeConfig = runtimeBootstrap.firebaseConfig;
const FIREBASE_CDN_VERSION = runtimeBootstrap.firebaseCdnVersion ?? DEFAULT_FIREBASE_CDN_VERSION;

let messaging = null;

try {
  importScripts(
    `https://www.gstatic.com/firebasejs/${FIREBASE_CDN_VERSION}/firebase-app-compat.js`
  );
  importScripts(
    `https://www.gstatic.com/firebasejs/${FIREBASE_CDN_VERSION}/firebase-messaging-compat.js`
  );

  if (runtimeConfig && runtimeConfig.messagingSenderId) {
    firebase.initializeApp(runtimeConfig);
    messaging = firebase.messaging();
  }
} catch (error) {
  console.error('[firebase-messaging-sw] init_failed', error);
}

if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    const notification = payload.notification || {};
    const title = notification.title || 'Game Shelf';
    const options = {
      body: notification.body || '',
      data: payload.data || {}
    };
    return self.registration.showNotification(title, options);
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const routeFromPayload = event.notification?.data?.route;
  const route =
    typeof routeFromPayload === 'string' && routeFromPayload.startsWith('/')
      ? routeFromPayload
      : '/tabs/wishlist';
  event.waitUntil(clients.openWindow(route));
});
