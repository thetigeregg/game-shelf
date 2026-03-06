import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Messaging } from '@angular/fire/messaging';
import { deleteToken, getToken, isSupported, onMessage } from 'firebase/messaging';
import { environment } from '../../../environments/environment';
import { getAppVersion, getFirebaseVapidKey } from '../config/runtime-config';
import { SYNC_OUTBOX_WRITER, SyncOutboxWriter } from '../data/sync-outbox-writer';

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
  private readonly router = inject(Router);
  private readonly messaging = inject(Messaging, { optional: true });
  private readonly outboxWriter = inject<SyncOutboxWriter | null>(SYNC_OUTBOX_WRITER, {
    optional: true
  });
  private initialized = false;
  private initializing: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializing) {
      await this.initializing;
      return;
    }

    this.initializing = this.initializeInternal();
    try {
      await this.initializing;
      this.initialized = true;
    } finally {
      this.initializing = null;
    }
  }

  private async initializeInternal(): Promise<void> {
    if (!this.messaging) {
      return;
    }

    const supported = await isSupported().catch(() => false);

    if (!supported) {
      return;
    }

    onMessage(this.messaging, (payload) => {
      console.info('[notifications] foreground_message', payload);
      this.showForegroundNotification(payload);
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
        return false;
      }

      const normalized = raw.trim().toLowerCase();
      return normalized !== 'false' && normalized !== '0' && normalized !== 'no';
    } catch {
      return false;
    }
  }

  hasStoredReleaseNotificationsPreference(): boolean {
    try {
      return localStorage.getItem(RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY) !== null;
    } catch {
      return false;
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
          day: true
        };
      }

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // Default to enabled unless a toggle is explicitly persisted as false.
      return {
        set: parsed['set'] !== false,
        changed: parsed['changed'] !== false,
        removed: parsed['removed'] !== false,
        day: parsed['day'] !== false
      };
    } catch {
      return {
        set: true,
        changed: true,
        removed: true,
        day: true
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

    const registrationResult = await this.registerCurrentDevice();

    if (!registrationResult.ok) {
      return { ok: false, message: registrationResult.message };
    }

    return { ok: true, message: 'Notifications enabled on this device.' };
  }

  async shouldPromptForReleaseNotifications(): Promise<boolean> {
    if (this.hasStoredReleaseNotificationsPreference()) {
      return false;
    }

    if (!this.messaging) {
      return false;
    }

    const supported = await isSupported().catch(() => false);

    if (!supported) {
      return false;
    }

    if (typeof Notification === 'undefined') {
      return false;
    }

    return Notification.permission === 'default';
  }

  async enableReleaseNotifications(): Promise<{ ok: boolean; message: string }> {
    const result = await this.requestPermissionAndRegister();

    if (result.ok) {
      this.setReleaseNotificationsEnabled(true);
      return result;
    }

    this.setReleaseNotificationsEnabled(false);
    return result;
  }

  async disableReleaseNotifications(): Promise<{ ok: boolean; message: string }> {
    this.setReleaseNotificationsEnabled(false);
    return this.unregisterCurrentDevice();
  }

  setReleaseNotificationsEnabled(enabled: boolean): void {
    const value = enabled ? 'true' : 'false';
    try {
      localStorage.setItem(RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY, value);
    } catch {
      // Ignore storage write failures.
    }

    this.queueSettingUpsert(RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY, value);
  }

  async unregisterCurrentDevice(): Promise<{ ok: boolean; message: string }> {
    const storedToken = this.readStoredToken();
    const backendUnregisterOk = storedToken
      ? await firstValueFrom(
          this.httpClient.post(`${environment.gameApiBaseUrl}/v1/notifications/fcm/unregister`, {
            token: storedToken
          })
        )
          .then(() => true)
          .catch(() => false)
      : true;

    const firebaseDeleteOk = this.messaging
      ? await deleteToken(this.messaging)
          .then(() => true)
          .catch(() => false)
      : true;

    try {
      localStorage.removeItem(FCM_DEVICE_TOKEN_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }

    if (backendUnregisterOk && firebaseDeleteOk) {
      return { ok: true, message: 'Notifications disabled on this device.' };
    }

    return {
      ok: false,
      message: 'Notifications were disabled locally, but device unregister did not fully complete.'
    };
  }

  private async registerCurrentDevice(): Promise<
    { ok: true; token: string } | { ok: false; message: string }
  > {
    if (!this.messaging) {
      return { ok: false, message: 'Notifications are not available in this app session.' };
    }

    const serviceWorkerRegistration = await this.resolveServiceWorkerRegistration();
    const vapidKey = getFirebaseVapidKey().trim();

    if (!serviceWorkerRegistration) {
      return { ok: false, message: 'Unable to register notification service worker.' };
    }

    if (vapidKey.length === 0) {
      return { ok: false, message: 'Missing Firebase VAPID key in frontend environment config.' };
    }

    const token = await getToken(this.messaging, {
      vapidKey,
      serviceWorkerRegistration
    }).catch((error: unknown) => {
      console.error('[notifications] token_registration_failed', error);
      return null;
    });

    if (!token) {
      return {
        ok: false,
        message:
          'Unable to register the device for notifications. Check Firebase web config/VAPID values.'
      };
    }

    const registeredOnBackend = await firstValueFrom(
      this.httpClient.post(`${environment.gameApiBaseUrl}/v1/notifications/fcm/register`, {
        token,
        platform: this.resolveDevicePlatform(),
        appVersion: getAppVersion(),
        userAgent: navigator.userAgent,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
    ).catch((error: unknown) => {
      console.error('[notifications] backend_register_failed', error);
      return null;
    });

    if (!registeredOnBackend) {
      return {
        ok: false,
        message: 'Unable to save this device token on the server.'
      };
    }

    try {
      localStorage.setItem(FCM_DEVICE_TOKEN_STORAGE_KEY, token);
    } catch {
      // Ignore storage failures.
    }

    return { ok: true, token };
  }

  private async resolveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
    const workerUrl = this.buildFirebaseWorkerUrl();

    try {
      const existing = await navigator.serviceWorker.getRegistration(workerUrl);
      if (existing) {
        return existing;
      }

      return await navigator.serviceWorker.register(workerUrl);
    } catch (error) {
      console.error('[notifications] service_worker_register_failed', error);
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

  private buildFirebaseWorkerUrl(): string {
    return '/firebase-messaging-sw.js';
  }

  private showForegroundNotification(payload: {
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
  }): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return;
    }

    const title = payload.notification?.title?.trim() || 'Game Shelf';
    const body = payload.notification?.body?.trim() || '';

    try {
      const notification = new Notification(title, {
        body,
        data: payload.data ?? {}
      });

      notification.onclick = () => {
        window.focus();
        const route = payload.data?.['route'];
        if (typeof route === 'string' && route.startsWith('/')) {
          void this.router.navigateByUrl(route).catch(() => {
            window.location.assign(route);
          });
        }
      };
    } catch (error) {
      console.error('[notifications] foreground_notification_failed', error);
    }
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

  private queueSettingUpsert(key: string, value: string): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'setting',
      operation: 'upsert',
      payload: { key, value }
    });
  }
}
