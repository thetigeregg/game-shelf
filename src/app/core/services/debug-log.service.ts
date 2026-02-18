import { inject, Injectable } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router
} from '@angular/router';
import { Subscription } from 'rxjs';

export type DebugLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DebugLogEntry {
  ts: string;
  level: DebugLogLevel;
  message: string;
  details?: string;
}

@Injectable({ providedIn: 'root' })
export class DebugLogService {
  private static readonly STORAGE_KEY = 'game-shelf:debug-logs:v2';
  private static readonly VERBOSE_TRACE_STORAGE_KEY = 'game-shelf:debug-verbose-trace:v1';
  private static readonly LEGACY_STORAGE_KEYS = ['game-shelf:debug-logs:v1'];
  private static readonly MAX_ENTRIES = 8000;
  private static readonly MAX_DETAILS_LENGTH = 1600;
  private static readonly PERSIST_DEBOUNCE_MS = 750;
  private static readonly DEDUPE_WINDOW_MS = 3000;
  private initialized = false;
  private readonly entries: DebugLogEntry[] = [];
  private persistHandle: number | null = null;
  private routeSubscription: Subscription | null = null;
  private lastEntryFingerprint: string | null = null;
  private lastEntryAtMs = 0;
  private duplicateCount = 0;
  private verboseTracingEnabled = false;
  private readonly router = inject(Router, { optional: true });

  initialize(): void {
    if (this.initialized || typeof window === 'undefined') {
      return;
    }

    this.initialized = true;
    this.hydrate();
    this.hydrateVerboseTracingPreference();
    this.installConsoleCapture();
    this.installFetchCapture();
    this.installXhrCapture();
    this.installRouterCapture();

    window.addEventListener('error', (event) => {
      this.error('window.error', {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.error('window.unhandledrejection', this.normalizeUnknown(event.reason));
    });

    window.addEventListener('online', () => this.info('network.online'));
    window.addEventListener('offline', () => this.warn('network.offline'));
    window.addEventListener('beforeunload', () => this.persist(true));

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

  trace(message: string, payload?: unknown): void {
    if (!this.verboseTracingEnabled) {
      return;
    }

    this.append('debug', message, payload);
  }

  isVerboseTracingEnabled(): boolean {
    return this.verboseTracingEnabled;
  }

  setVerboseTracingEnabled(enabled: boolean): void {
    this.verboseTracingEnabled = Boolean(enabled);

    try {
      localStorage.setItem(
        DebugLogService.VERBOSE_TRACE_STORAGE_KEY,
        this.verboseTracingEnabled ? '1' : '0'
      );
    } catch {
      // Ignore storage failures.
    }

    this.info('debug.verbose_tracing_updated', { enabled: this.verboseTracingEnabled });
  }

  clear(): void {
    this.entries.length = 0;
    this.lastEntryFingerprint = null;
    this.lastEntryAtMs = 0;
    this.duplicateCount = 0;

    try {
      localStorage.removeItem(DebugLogService.STORAGE_KEY);
      DebugLogService.LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Ignore storage failures.
    }
  }

  exportText(): string {
    const header = [
      `Game Shelf Debug Logs`,
      `Generated: ${new Date().toISOString()}`,
      `Entries: ${this.entries.length}`,
      ''
    ];
    const lines = this.entries.map((entry) => {
      const base = `[${entry.ts}] [${entry.level.toUpperCase()}] ${entry.message}`;
      return entry.details ? `${base} | ${entry.details}` : base;
    });

    return [...header, ...lines].join('\n');
  }

  private append(level: DebugLogLevel, message: string, payload?: unknown): void {
    const normalizedMessage = String(message ?? '').trim() || 'log';
    const details = payload === undefined ? undefined : this.safeStringify(payload);
    const now = Date.now();
    const fingerprint = `${level}|${normalizedMessage}|${details ?? ''}`;

    if (
      this.lastEntryFingerprint === fingerprint &&
      now - this.lastEntryAtMs <= DebugLogService.DEDUPE_WINDOW_MS
    ) {
      this.duplicateCount += 1;
      this.lastEntryAtMs = now;
      return;
    }

    if (this.duplicateCount > 0) {
      this.entries.push({
        ts: new Date(this.lastEntryAtMs).toISOString(),
        level: 'debug',
        message: 'log.duplicates',
        details: this.safeStringify({ count: this.duplicateCount })
      });
      this.duplicateCount = 0;
    }

    this.entries.push({
      ts: new Date().toISOString(),
      level,
      message: normalizedMessage,
      details
    });
    this.lastEntryFingerprint = fingerprint;
    this.lastEntryAtMs = now;

    if (this.entries.length > DebugLogService.MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - DebugLogService.MAX_ENTRIES);
    }

    this.persist();
  }

  private persist(immediate = false): void {
    if (immediate) {
      if (this.persistHandle !== null) {
        window.clearTimeout(this.persistHandle);
        this.persistHandle = null;
      }
      this.writeToStorage();
      return;
    }

    if (this.persistHandle !== null) {
      return;
    }

    this.persistHandle = window.setTimeout(() => {
      this.persistHandle = null;
      this.writeToStorage();
    }, DebugLogService.PERSIST_DEBOUNCE_MS);
  }

  private writeToStorage(): void {
    try {
      localStorage.setItem(DebugLogService.STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Ignore storage failures.
    }
  }

  private hydrate(): void {
    try {
      const keys = [DebugLogService.STORAGE_KEY, ...DebugLogService.LEGACY_STORAGE_KEYS];
      const raw = keys
        .map((key) => localStorage.getItem(key))
        .find((value) => typeof value === 'string' && value.length > 0);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return;
      }

      const normalized = parsed
        .map((item) => {
          const ts = typeof item?.ts === 'string' ? item.ts : '';
          const level =
            item?.level === 'debug' ||
            item?.level === 'info' ||
            item?.level === 'warn' ||
            item?.level === 'error'
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

  private hydrateVerboseTracingPreference(): void {
    try {
      this.verboseTracingEnabled =
        localStorage.getItem(DebugLogService.VERBOSE_TRACE_STORAGE_KEY) === '1';
    } catch {
      this.verboseTracingEnabled = false;
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
      error: console.error.bind(console)
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

  private installFetchCapture(): void {
    const target = window as Window & {
      __gsDebugFetchCaptureInstalled?: boolean;
      __gsDebugFetchOriginal?: typeof fetch;
    };

    if (target.__gsDebugFetchCaptureInstalled || typeof window.fetch !== 'function') {
      return;
    }

    const originalFetch = window.fetch.bind(window);
    target.__gsDebugFetchOriginal = originalFetch;
    target.__gsDebugFetchCaptureInstalled = true;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = this.resolveRequestUrl(input);
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      const startedAt = Date.now();
      this.debug('http.fetch.start', { method, url: requestUrl });

      try {
        const response = await originalFetch(input, init);
        this.debug('http.fetch.end', {
          method,
          url: requestUrl,
          status: response.status,
          durationMs: Date.now() - startedAt
        });
        return response;
      } catch (error: unknown) {
        this.error('http.fetch.error', {
          method,
          url: requestUrl,
          durationMs: Date.now() - startedAt,
          error: this.normalizeUnknown(error)
        });
        throw error;
      }
    };
  }

  private installXhrCapture(): void {
    const target = window as Window & {
      __gsDebugXhrCaptureInstalled?: boolean;
    };

    if (target.__gsDebugXhrCaptureInstalled || typeof XMLHttpRequest === 'undefined') {
      return;
    }

    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    const setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest & {
        __gsMethod?: string;
        __gsUrl?: string;
        __gsStartedAt?: number;
      },
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ): void {
      this.__gsMethod = String(method ?? 'GET').toUpperCase();
      this.__gsUrl = String(url ?? '');
      return open.call(
        this,
        method,
        url,
        async ?? true,
        username ?? undefined,
        password ?? undefined
      );
    };

    XMLHttpRequest.prototype.setRequestHeader = function (
      this: XMLHttpRequest,
      name: string,
      value: string
    ): void {
      return setRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest & {
        __gsMethod?: string;
        __gsUrl?: string;
        __gsStartedAt?: number;
      },
      body?: Document | XMLHttpRequestBodyInit | null
    ): void {
      const method = this.__gsMethod ?? 'GET';
      const url = this.__gsUrl ?? '';
      this.__gsStartedAt = Date.now();
      const logger = (window as Window & { __gsDebugLogger?: DebugLogService }).__gsDebugLogger;
      logger?.debug('http.xhr.start', { method, url });

      this.addEventListener('loadend', () => {
        logger?.debug('http.xhr.end', {
          method,
          url,
          status: this.status,
          durationMs: Date.now() - (this.__gsStartedAt ?? Date.now())
        });
      });

      this.addEventListener('error', () => {
        logger?.error('http.xhr.error', {
          method,
          url,
          durationMs: Date.now() - (this.__gsStartedAt ?? Date.now())
        });
      });

      return send.call(this, body ?? null);
    };

    (window as Window & { __gsDebugLogger?: DebugLogService }).__gsDebugLogger = this;
    target.__gsDebugXhrCaptureInstalled = true;
  }

  private installRouterCapture(): void {
    if (!this.router || this.routeSubscription) {
      return;
    }

    this.routeSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.info('router.navigation_start', { id: event.id, url: event.url });
      } else if (event instanceof NavigationEnd) {
        this.info('router.navigation_end', { id: event.id, url: event.urlAfterRedirects });
      } else if (event instanceof NavigationCancel) {
        this.warn('router.navigation_cancel', {
          id: event.id,
          url: event.url,
          reason: event.reason
        });
      } else if (event instanceof NavigationError) {
        this.error('router.navigation_error', {
          id: event.id,
          url: event.url,
          error: this.normalizeUnknown(event.error)
        });
      }
    });
  }

  private safeStringify(value: unknown): string {
    if (value instanceof Error) {
      return JSON.stringify({
        name: value.name,
        message: value.message,
        stack: value.stack
      });
    }

    try {
      const cache = new Set<unknown>();

      const serialized = JSON.stringify(value, (_key, current) => {
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
      return serialized.length > DebugLogService.MAX_DETAILS_LENGTH
        ? `${serialized.slice(0, DebugLogService.MAX_DETAILS_LENGTH)}...[truncated]`
        : serialized;
    } catch {
      const fallback = String(value);
      return fallback.length > DebugLogService.MAX_DETAILS_LENGTH
        ? `${fallback.slice(0, DebugLogService.MAX_DETAILS_LENGTH)}...[truncated]`
        : fallback;
    }
  }

  private resolveRequestUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') {
      return input;
    }

    if (input instanceof URL) {
      return input.toString();
    }

    if (typeof Request !== 'undefined' && input instanceof Request) {
      return input.url;
    }

    return String(input ?? '');
  }

  private normalizeUnknown(value: unknown): unknown {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
    }

    return value;
  }
}
