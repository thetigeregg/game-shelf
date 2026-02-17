/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

const defaultConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
const configFromQuery = (() => {
  try {
    const url = new URL(self.location.href);
    const raw = url.searchParams.get('firebaseConfig');
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
})();
const runtimeConfig = configFromQuery || self.GAME_SHELF_FIREBASE_CONFIG || defaultConfig;

if (runtimeConfig.messagingSenderId) {
  firebase.initializeApp(runtimeConfig);

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(payload => {
    const notification = payload.notification || {};
    const title = notification.title || 'Game Shelf';
    const options = {
      body: notification.body || '',
      data: payload.data || {},
    };
    self.registration.showNotification(title, options);
  });

  self.addEventListener('notificationclick', event => {
    event.notification.close();
    const route = event.notification?.data?.route || '/tabs/wishlist';
    event.waitUntil(clients.openWindow(route));
  });
}
