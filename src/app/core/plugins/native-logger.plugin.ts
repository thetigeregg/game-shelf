import { registerPlugin } from '@capacitor/core';

export interface NativeLogOptions {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  details?: string;
}

export interface NativeLoggerPlugin {
  log(options: NativeLogOptions): Promise<void>;
  exportLogs(): Promise<{ content: string }>;
  clearLogs(): Promise<void>;
}

class NativeLoggerWeb implements NativeLoggerPlugin {
  log(_options: NativeLogOptions): Promise<void> {
    return Promise.resolve();
  }

  exportLogs(): Promise<{ content: string }> {
    return Promise.resolve({ content: '' });
  }

  clearLogs(): Promise<void> {
    return Promise.resolve();
  }
}

export const NativeLogger = registerPlugin<NativeLoggerPlugin>('NativeLogger', {
  web: () => new NativeLoggerWeb(),
});
