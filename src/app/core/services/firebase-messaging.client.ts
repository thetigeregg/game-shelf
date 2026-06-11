import type { FirebaseNotificationListenerEvent } from './firebase-messaging.types';

/**
 * Web/browser stub. Push notifications are native-only; this module satisfies the
 * bundler without pulling in the Firebase JS SDK. iOS builds replace this file via
 * angular.json fileReplacements.
 */
export const FirebaseMessaging = {
  checkPermissions: (): Promise<{ receive: string }> => Promise.resolve({ receive: 'denied' }),
  requestPermissions: (): Promise<{ receive: string }> => Promise.resolve({ receive: 'denied' }),
  getToken: (): Promise<{ token: string }> => Promise.resolve({ token: '' }),
  deleteToken: (): Promise<void> => Promise.resolve(),
  addListener: (
    _eventName: string,
    _listener: (event: FirebaseNotificationListenerEvent) => void
  ): Promise<{ remove: () => void }> => Promise.resolve({ remove: () => undefined }),
};
