import { Injectable } from '@angular/core';
import { Network } from '@capacitor/network';
import { isNativePlatform } from '../utils/native-platform.util';

export type ConnectedChangeListener = (connected: boolean) => void;

@Injectable({ providedIn: 'root' })
export class NetworkConnectivityService {
  private initialized = false;
  private connected = true;
  private readonly listeners = new Set<ConnectedChangeListener>();
  private readonly webOnlineHandler = () => {
    this.setConnected(true);
  };
  private readonly webOfflineHandler = () => {
    this.setConnected(false);
  };

  initialize(): void {
    if (this.initialized || typeof window === 'undefined') {
      return;
    }

    this.initialized = true;

    if (isNativePlatform()) {
      void this.initializeNative();
      return;
    }

    this.initializeWeb();
  }

  isConnected(): boolean {
    return this.connected;
  }

  onConnectedChange(listener: ConnectedChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private initializeWeb(): void {
    this.connected = this.readWebConnected();
    window.addEventListener('online', this.webOnlineHandler);
    window.addEventListener('offline', this.webOfflineHandler);
  }

  private async initializeNative(): Promise<void> {
    try {
      const status = await Network.getStatus();
      this.connected = status.connected;
    } catch {
      this.connected = this.readWebConnected();
    }

    try {
      await Network.addListener('networkStatusChange', (status) => {
        this.setConnected(status.connected);
      });
    } catch {
      this.initializeWeb();
    }
  }

  private readWebConnected(): boolean {
    if (typeof navigator === 'undefined') {
      return true;
    }

    return navigator.onLine;
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) {
      return;
    }

    this.connected = connected;
    this.listeners.forEach((listener) => {
      listener(connected);
    });
  }
}
