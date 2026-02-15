import { Injectable } from '@angular/core';

export type DebugLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DebugLogEntry {
  ts: string;
  level: DebugLogLevel;
  message: string;
  details?: string;
}

@Injectable({ providedIn: 'root' })
export class DebugLogService {
  private static readonly STORAGE_KEY = 'game-shelf:debug-logs:v1';
  private static readonly MAX_ENTRIES = 1200;
  private initialized = false;
  private readonly entries: DebugLogEntry[] = [];

  initialize(): void {
    if (this.initialized || typeof window === 'undefined') {
      return;
    }

    this.initialized = true;
    this.hydrate();
    this.installConsoleCapture();

    window.addEventListener('error', event => {
      this.error('window.error', {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    });

    window.addEventListener('unhandledrejection', event => {
      this.error('window.unhandledrejection', this.normalizeUnknown(event.reason));
    });

    window.addEventListener('online', () => this.info('network.online'));
    window.addEventListener('offline', () => this.warn('network.offline'));

    this.info('debug_logger_initialized');
  }

  debug(message: string, payload?: unknown): void {
    this.append('debug', message, payload);
  }

  info(message: string, payload?: unknown): void {
    this.append('info', message, payload);
  }

  warn(message: string, payload?: unknown): void {
    this.append('warn', message, payload);
  }

  error(message: string, payload?: unknown): void {
    this.append('error', message, payload);
  }

  clear(): void {
    this.entries.length = 0;

    try {
      localStorage.removeItem(DebugLogService.STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  exportText(): string {
    const header = [
      `Game Shelf Debug Logs`,
      `Generated: ${new Date().toISOString()}`,
      `Entries: ${this.entries.length}`,
      '',
    ];
    const lines = this.entries.map(entry => {
      const base = `[${entry.ts}] [${entry.level.toUpperCase()}] ${entry.message}`;
      return entry.details ? `${base} | ${entry.details}` : base;
    });

    return [...header, ...lines].join('\n');
  }

  private append(level: DebugLogLevel, message: string, payload?: unknown): void {
    const details = payload === undefined ? undefined : this.safeStringify(payload);
    this.entries.push({
      ts: new Date().toISOString(),
      level,
      message: String(message ?? '').trim() || 'log',
      details,
    });

    if (this.entries.length > DebugLogService.MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - DebugLogService.MAX_ENTRIES);
    }

    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(DebugLogService.STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Ignore storage failures.
    }
  }

  private hydrate(): void {
    try {
      const raw = localStorage.getItem(DebugLogService.STORAGE_KEY);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return;
      }

      const normalized = parsed
        .map(item => {
          const ts = typeof item?.ts === 'string' ? item.ts : '';
          const level = item?.level === 'debug' || item?.level === 'info' || item?.level === 'warn' || item?.level === 'error'
            ? item.level
            : null;
          const message = typeof item?.message === 'string' ? item.message : '';
          const details = typeof item?.details === 'string' ? item.details : undefined;

          if (ts.length === 0 || level === null || message.length === 0) {
            return null;
          }

          return { ts, level, message, details } as DebugLogEntry;
        })
        .filter((entry): entry is DebugLogEntry => entry !== null);

      this.entries.push(...normalized.slice(-DebugLogService.MAX_ENTRIES));
    } catch {
      // Ignore malformed cache.
    }
  }

  private installConsoleCapture(): void {
    const consoleLike = console as Console & {
      __gsDebugCaptureInstalled?: boolean;
      __gsDebugCapture?: {
        log: typeof console.log;
        info: typeof console.info;
        warn: typeof console.warn;
        error: typeof console.error;
      };
    };

    if (consoleLike.__gsDebugCaptureInstalled) {
      return;
    }

    const original = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
    consoleLike.__gsDebugCapture = original;
    consoleLike.__gsDebugCaptureInstalled = true;

    console.log = (...args: unknown[]) => {
      this.append('debug', 'console.log', args);
      original.log(...args);
    };

    console.info = (...args: unknown[]) => {
      this.append('info', 'console.info', args);
      original.info(...args);
    };

    console.warn = (...args: unknown[]) => {
      this.append('warn', 'console.warn', args);
      original.warn(...args);
    };

    console.error = (...args: unknown[]) => {
      this.append('error', 'console.error', args);
      original.error(...args);
    };
  }

  private safeStringify(value: unknown): string {
    if (value instanceof Error) {
      return JSON.stringify({
        name: value.name,
        message: value.message,
        stack: value.stack,
      });
    }

    try {
      const cache = new Set<unknown>();

      return JSON.stringify(value, (_key, current) => {
        if (typeof current === 'bigint') {
          return current.toString();
        }

        if (typeof current === 'object' && current !== null) {
          if (cache.has(current)) {
            return '[Circular]';
          }

          cache.add(current);
        }

        return current;
      });
    } catch {
      return String(value);
    }
  }

  private normalizeUnknown(value: unknown): unknown {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    return value;
  }
}

