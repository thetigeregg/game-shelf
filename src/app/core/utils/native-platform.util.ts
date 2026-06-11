import { Capacitor } from '@capacitor/core';

/** True when running inside the Capacitor native shell (iOS app), false in browsers. */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/** Capacitor platform identifier: 'ios', 'android', or 'web'. */
export function getNativePlatform(): string {
  return Capacitor.getPlatform();
}
