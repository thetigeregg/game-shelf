import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Messaging } from '@angular/fire/messaging';
import { deleteToken, getToken, isSupported, onMessage } from 'firebase/messaging';
import { environment } from '../../../environments/environment';

export const RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY = 'game-shelf:notifications:release:enabled';
export const RELEASE_NOTIFICATION_EVENTS_STORAGE_KEY = 'game-shelf:notifications:release:events';
const FCM_DEVICE_TOKEN_STORAGE_KEY = 'game-shelf:notifications:fcm-token';

export interface ReleaseNotificationEventsPreference {
  set: boolean;
  changed: boolean;
  removed: boolean;
  day: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly httpClient = inject(HttpClient);
  private readonly messaging = inject(Messaging, { optional: true });
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    if (!this.messaging) {
      return;
    }

    const supported = await isSupported().catch(() => false);

    if (!supported) {
      return;
    }

    onMessage(this.messaging, payload => {
      console.info('[notifications] foreground_message', payload);
    });

    if (!this.isReleaseNotificationsEnabled()) {
      return;
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      await this.registerCurrentDevice();
    }
  }

  isReleaseNotificationsEnabled(): boolean {
    try {
      const raw = localStorage.getItem(RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY);
      if (raw === null) {
        return true;
      }

      const normalized = raw.trim().toLowerCase();
      return normalized !== 'false' && normalized !== '0' && normalized !== 'no';
    } catch {
      return true;
    }
  }

  readReleaseEventPreferences(): ReleaseNotificationEventsPreference {
    try {
      const raw = localStorage.getItem(RELEASE_NOTIFICATION_EVENTS_STORAGE_KEY);

      if (!raw) {
        return {
          set: true,
          changed: true,
          removed: true,
          day: true,
        };
      }

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        set: parsed['set'] === false ? false : true,
        changed: parsed['changed'] === false ? false : true,
        removed: parsed['removed'] === false ? false : true,
        day: parsed['day'] === false ? false : true,
      };
    } catch {
      return {
        set: true,
        changed: true,
        removed: true,
        day: true,
      };
    }
  }

  async requestPermissionAndRegister(): Promise<{ ok: boolean; message: string }> {
    if (!this.messaging) {
      return { ok: false, message: 'Notifications are not supported on this device.' };
    }

    const supported = await isSupported().catch(() => false);

    if (!supported) {
      return { ok: false, message: 'Notifications are not supported in this browser.' };
    }

    if (typeof Notification === 'undefined') {
      return { ok: false, message: 'Notification API is unavailable.' };
    }

    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
      return { ok: false, message: 'Notification permission was not granted.' };
    }

    const token = await this.registerCurrentDevice();

    if (!token) {
      return { ok: false, message: 'Unable to register device for notifications.' };
    }

    return { ok: true, message: 'Notifications enabled on this device.' };
  }

  async unregisterCurrentDevice(): Promise<void> {
    const storedToken = this.readStoredToken();

    if (storedToken) {
      await firstValueFrom(
        this.httpClient.post(
          `${environment.gameApiBaseUrl}/v1/notifications/fcm/unregister`,
          { token: storedToken },
        ),
      ).catch(() => undefined);
    }

    if (this.messaging && storedToken) {
      await deleteToken(this.messaging).catch(() => undefined);
    }

    try {
      localStorage.removeItem(FCM_DEVICE_TOKEN_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  private async registerCurrentDevice(): Promise<string | null> {
    if (!this.messaging) {
      return null;
    }

    const serviceWorkerRegistration = await this.resolveServiceWorkerRegistration();
    const vapidKey = String(environment.firebaseVapidKey ?? '').trim();

    if (!serviceWorkerRegistration || vapidKey.length === 0) {
      return null;
    }

    const token = await getToken(this.messaging, {
      vapidKey,
      serviceWorkerRegistration,
    }).catch(() => null);

    if (!token) {
      return null;
    }

    await firstValueFrom(
      this.httpClient.post(
        `${environment.gameApiBaseUrl}/v1/notifications/fcm/register`,
        {
          token,
          platform: this.resolveDevicePlatform(),
          appVersion: this.resolveUserAgentPlatform(),
          userAgent: navigator.userAgent,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
        },
      ),
    ).catch(() => null);

    try {
      localStorage.setItem(FCM_DEVICE_TOKEN_STORAGE_KEY, token);
    } catch {
      // Ignore storage failures.
    }

    return token;
  }

  private async resolveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      return null;
    }

    const workerUrl = this.buildFirebaseWorkerUrl();

    try {
      const existing = await navigator.serviceWorker.getRegistration(workerUrl);
      if (existing) {
        return existing;
      }

      return await navigator.serviceWorker.register(workerUrl);
    } catch {
      return null;
    }
  }

  private resolveDevicePlatform(): 'web' | 'android' | 'ios' {
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) {
      return 'ios';
    }

    if (/android/.test(ua)) {
      return 'android';
    }

    return 'web';
  }

  private resolveUserAgentPlatform(): string | null {
    const navigatorWithUserAgentData = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    const platform = navigatorWithUserAgentData.userAgentData?.platform;
    return typeof platform === 'string' && platform.trim().length > 0 ? platform.trim() : null;
  }

  private buildFirebaseWorkerUrl(): string {
    const configJson = JSON.stringify(environment.firebase);
    const encoded = encodeURIComponent(configJson);
    return `/firebase-messaging-sw.js?firebaseConfig=${encoded}`;
  }

  private readStoredToken(): string | null {
    try {
      const raw = localStorage.getItem(FCM_DEVICE_TOKEN_STORAGE_KEY);
      const normalized = typeof raw === 'string' ? raw.trim() : '';
      return normalized.length > 0 ? normalized : null;
    } catch {
      return null;
    }
  }
}
