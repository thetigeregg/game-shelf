import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { FirebaseMessaging } from './firebase-messaging.client';
import type { FirebaseNotificationListenerEvent } from './firebase-messaging.types';
import { environment } from '../../../environments/environment';
import { getAppVersion } from '../config/runtime-config';
import { SYNC_OUTBOX_WRITER, SyncOutboxWriter } from '../data/sync-outbox-writer';
import { coercePreferenceBoolean, isDisabledPreferenceValue } from '../utils/preference-bool';
import { getNativePlatform, isNativePlatform } from '../utils/native-platform.util';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { DebugLogService } from './debug-log.service';

export const RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY = 'game-shelf:notifications:release:enabled';
export const RELEASE_NOTIFICATION_EVENTS_STORAGE_KEY = 'game-shelf:notifications:release:events';
const FCM_DEVICE_TOKEN_STORAGE_KEY = 'game-shelf:notifications:fcm-token';

export interface ReleaseNotificationEventsPreference {
  set: boolean;
  changed: boolean;
  removed: boolean;
  day: boolean;
  sale: boolean;
}

/**
 * Release notifications are native push only (APNs via FCM through
 * `@capacitor-firebase/messaging` on Capacitor iOS). The web app has no push support.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly httpClient = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly preferenceStorage = inject(PreferenceStorageService);
  private readonly debugLogService = inject(DebugLogService);
  private readonly outboxWriter = inject<SyncOutboxWriter | null>(SYNC_OUTBOX_WRITER, {
    optional: true,
  });
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private nativeListenersAttached = false;

  /** True only in the Capacitor native shell; the web app has no push support. */
  isPushSupported(): boolean {
    return isNativePlatform();
  }

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
    this.debugLogService.trace('notifications.init.start');

    if (!this.isPushSupported()) {
      this.debugLogService.trace('notifications.init.push_not_supported');
      return;
    }

    await this.attachNativeListeners();

    const releaseEnabled = this.isReleaseNotificationsEnabled();
    this.debugLogService.trace('notifications.init.release_enabled', { releaseEnabled });

    if (!releaseEnabled) {
      return;
    }

    const permission = await this.checkNativePermission();
    this.debugLogService.trace('notifications.init.permission_state', { permission });

    if (permission === 'granted') {
      await this.registerCurrentDevice();
    }
  }

  isReleaseNotificationsEnabled(): boolean {
    try {
      const raw = this.preferenceStorage.getItem(RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY);
      if (raw === null) {
        return false;
      }

      const normalized = raw.trim().toLowerCase();
      return !isDisabledPreferenceValue(normalized);
    } catch {
      return false;
    }
  }

  hasStoredReleaseNotificationsPreference(): boolean {
    try {
      return this.preferenceStorage.getItem(RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  readReleaseEventPreferences(): ReleaseNotificationEventsPreference {
    try {
      const raw = this.preferenceStorage.getItem(RELEASE_NOTIFICATION_EVENTS_STORAGE_KEY);

      if (!raw) {
        return { set: true, changed: true, removed: true, day: true, sale: true };
      }

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        set: coercePreferenceBoolean(parsed['set'], true),
        changed: coercePreferenceBoolean(parsed['changed'], true),
        removed: coercePreferenceBoolean(parsed['removed'], true),
        day: coercePreferenceBoolean(parsed['day'], true),
        sale: coercePreferenceBoolean(parsed['sale'], true),
      };
    } catch {
      return { set: true, changed: true, removed: true, day: true, sale: true };
    }
  }

  async requestPermissionAndRegister(): Promise<{ ok: boolean; message: string }> {
    if (!this.isPushSupported()) {
      return { ok: false, message: 'Notifications are not supported on this device.' };
    }

    this.debugLogService.trace('notifications.permission_request.start');

    const permission = await FirebaseMessaging.requestPermissions()
      .then((status) => status.receive)
      .catch((error: unknown) => {
        this.debugLogService.error('notifications.permission_request_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return 'denied' as const;
      });

    this.debugLogService.trace('notifications.permission_request.result', { permission });

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

    if (!this.isPushSupported()) {
      return false;
    }

    const permission = await this.checkNativePermission();
    return permission === 'prompt' || permission === 'prompt-with-rationale';
  }

  async enableReleaseNotifications(): Promise<{ ok: boolean; message: string }> {
    const result = await this.requestPermissionAndRegister();

    if (result.ok) {
      // Persist enabled only after permission + backend/device registration succeeds.
      this.setReleaseNotificationsEnabled(true);
      return result;
    }

    this.setReleaseNotificationsEnabled(false);
    return result;
  }

  async registerCurrentDeviceIfPermitted(): Promise<{ ok: boolean; message: string }> {
    if (!this.isReleaseNotificationsEnabled()) {
      return { ok: false, message: 'Release notifications are disabled.' };
    }

    if (!this.isPushSupported()) {
      return { ok: false, message: 'Notifications are not supported on this device.' };
    }

    const permission = await this.checkNativePermission();

    if (permission !== 'granted') {
      return { ok: false, message: 'Notification permission has not been granted on this device.' };
    }

    const registrationResult = await this.registerCurrentDevice();
    if (!registrationResult.ok) {
      return { ok: false, message: registrationResult.message };
    }

    return { ok: true, message: 'Notifications enabled on this device.' };
  }

  async disableReleaseNotifications(): Promise<{ ok: boolean; message: string }> {
    const result = await this.unregisterCurrentDevice();
    if (result.ok) {
      this.setReleaseNotificationsEnabled(false);
    }
    return result;
  }

  setReleaseNotificationsEnabled(enabled: boolean): void {
    const value = enabled ? 'true' : 'false';
    try {
      this.preferenceStorage.setItem(RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY, value);
    } catch {
      // Ignore storage write failures.
    }

    this.queueSettingUpsert(RELEASE_NOTIFICATIONS_ENABLED_STORAGE_KEY, value);
  }

  async unregisterCurrentDevice(): Promise<{ ok: boolean; message: string }> {
    const storedToken = this.readStoredToken();
    this.debugLogService.trace('notifications.unregister.start', {
      hasToken: storedToken !== null,
    });

    const backendUnregisterOk = storedToken
      ? await firstValueFrom(
          this.httpClient.post(`${environment.gameApiBaseUrl}/v1/notifications/fcm/unregister`, {
            token: storedToken,
          })
        )
          .then(() => true)
          .catch(() => false)
      : true;

    this.debugLogService.trace('notifications.unregister.backend_result', { backendUnregisterOk });

    const firebaseDeleteOk = this.isPushSupported()
      ? await FirebaseMessaging.deleteToken()
          .then(() => true)
          .catch(() => false)
      : true;

    this.debugLogService.trace('notifications.unregister.firebase_delete_result', {
      firebaseDeleteOk,
    });

    try {
      this.preferenceStorage.removeItem(FCM_DEVICE_TOKEN_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }

    if (backendUnregisterOk && firebaseDeleteOk) {
      return { ok: true, message: 'Notifications disabled on this device.' };
    }

    return {
      ok: false,
      message: 'Notifications were disabled locally, but device unregister did not fully complete.',
    };
  }

  private async registerCurrentDevice(): Promise<
    { ok: true; token: string } | { ok: false; message: string }
  > {
    if (!this.isPushSupported()) {
      return { ok: false, message: 'Notifications are not available in this app session.' };
    }

    this.debugLogService.trace('notifications.register_device.fetching_token');

    const token = await FirebaseMessaging.getToken()
      .then((result) => result.token)
      .catch((error: unknown) => {
        this.debugLogService.error('notifications.token_fetch_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

    if (!token || token.trim().length === 0) {
      this.debugLogService.warn('notifications.register_device.token_empty');
      return {
        ok: false,
        message:
          'Unable to register the device for notifications. Check the Firebase iOS configuration.',
      };
    }

    this.debugLogService.trace('notifications.register_device.token_fetched', {
      tokenPrefix: token.slice(0, 8),
    });

    const registeredOnBackend = await firstValueFrom(
      this.httpClient.post(`${environment.gameApiBaseUrl}/v1/notifications/fcm/register`, {
        token,
        platform: this.resolveDevicePlatform(),
        appVersion: getAppVersion(),
        userAgent: navigator.userAgent,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
    ).catch((error: unknown) => {
      this.debugLogService.error('notifications.backend_register_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });

    if (!registeredOnBackend) {
      return {
        ok: false,
        message: 'Unable to save this device token on the server.',
      };
    }

    this.debugLogService.trace('notifications.register_device.backend_registered');

    try {
      this.preferenceStorage.setItem(FCM_DEVICE_TOKEN_STORAGE_KEY, token);
      this.debugLogService.trace('notifications.register_device.token_stored');
    } catch {
      // Ignore storage failures.
    }

    return { ok: true, token };
  }

  private async checkNativePermission(): Promise<string> {
    return FirebaseMessaging.checkPermissions()
      .then((status) => {
        this.debugLogService.trace('notifications.permission_check.result', {
          permission: status.receive,
        });
        return status.receive;
      })
      .catch((error: unknown) => {
        this.debugLogService.error('notifications.permission_check_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return 'denied';
      });
  }

  private async attachNativeListeners(): Promise<void> {
    if (this.nativeListenersAttached) {
      return;
    }

    this.nativeListenersAttached = true;
    this.debugLogService.trace('notifications.listeners.attaching');

    // Foreground presentation is handled natively via the FirebaseMessaging
    // `presentationOptions` in capacitor.config.ts; this listener is for diagnostics.
    await FirebaseMessaging.addListener(
      'notificationReceived',
      (event: FirebaseNotificationListenerEvent) => {
        this.debugLogService.info('notifications.notification_received', {
          title: event.notification.title,
        });
      }
    ).catch((error: unknown) => {
      this.debugLogService.error('notifications.listener_attach_failed', {
        listener: 'notificationReceived',
        error: error instanceof Error ? error.message : String(error),
      });
    });

    await FirebaseMessaging.addListener(
      'notificationActionPerformed',
      (event: FirebaseNotificationListenerEvent) => {
        const route = this.extractRoute(event.notification.data);
        this.debugLogService.trace('notifications.action_performed', {
          hasRoute: route !== null,
          route: route?.replace(/[?#].*$/, '') ?? null,
        });
        if (route !== null) {
          void this.router.navigateByUrl(route).catch(() => {
            window.location.assign(route);
          });
        }
      }
    ).catch((error: unknown) => {
      this.debugLogService.error('notifications.listener_attach_failed', {
        listener: 'notificationActionPerformed',
        error: error instanceof Error ? error.message : String(error),
      });
    });

    this.debugLogService.trace('notifications.listeners.attached');
  }

  private extractRoute(data: unknown): string | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const route = (data as Record<string, unknown>)['route'];
    return typeof route === 'string' && route.startsWith('/') ? route : null;
  }

  private resolveDevicePlatform(): 'web' | 'android' | 'ios' {
    const platform = getNativePlatform();
    if (platform === 'ios' || platform === 'android') {
      return platform;
    }

    return 'web';
  }

  private readStoredToken(): string | null {
    try {
      const raw = this.preferenceStorage.getItem(FCM_DEVICE_TOKEN_STORAGE_KEY);
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
      payload: { key, value },
    });
  }
}
