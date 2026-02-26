export const environment = {
  production: false,
  gameApiBaseUrl: 'http://localhost:3000',
  manualsBaseUrl: '/manuals',
  featureFlags: {
    showMgcImport: false,
    e2eFixtures: false
  },
  firebase: {
    apiKey: 'REPLACE_WITH_FIREBASE_API_KEY',
    authDomain: 'REPLACE_WITH_FIREBASE_AUTH_DOMAIN',
    projectId: 'REPLACE_WITH_FIREBASE_PROJECT_ID',
    storageBucket: 'REPLACE_WITH_FIREBASE_STORAGE_BUCKET',
    messagingSenderId: 'REPLACE_WITH_FIREBASE_MESSAGING_SENDER_ID',
    appId: 'REPLACE_WITH_FIREBASE_APP_ID'
  },
  firebaseVapidKey: 'REPLACE_WITH_FIREBASE_VAPID_KEY'
};
