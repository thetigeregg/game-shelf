import { describe, expect, it, vi } from 'vitest';

import { FirebaseMessaging } from './firebase-messaging.client';

describe('FirebaseMessaging client stub', () => {
  it('returns denied permissions and empty token on web builds', async () => {
    await expect(FirebaseMessaging.checkPermissions()).resolves.toEqual({ receive: 'denied' });
    await expect(FirebaseMessaging.requestPermissions()).resolves.toEqual({ receive: 'denied' });
    await expect(FirebaseMessaging.getToken()).resolves.toEqual({ token: '' });
    await expect(FirebaseMessaging.deleteToken()).resolves.toBeUndefined();
  });

  it('registers listeners with a removable no-op handle', async () => {
    const listener = vi.fn();
    const handle = await FirebaseMessaging.addListener('notificationReceived', listener);

    expect(handle.remove).toEqual(expect.any(Function));
    expect(() => {
      handle.remove();
    }).not.toThrow();
  });
});
