const defaultConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};
const runtimeConfig = (() => {
  try {
    importScripts('/assets/runtime-config.js');
  } catch {
    // Runtime config is optional in development/fallback contexts.
  }

  try {
    const runtime = globalThis.__GAME_SHELF_RUNTIME_CONFIG__;
    const firebaseConfig = runtime?.firebase;
    if (!firebaseConfig || typeof firebaseConfig !== 'object') {
      return defaultConfig;
    }

    return {
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
    };
  } catch {
    return defaultConfig;
  }
})();

let messaging = null;

try {
  importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

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
    self.registration.showNotification(title, options);
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
