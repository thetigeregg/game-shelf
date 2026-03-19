declare module '../../shared/provider-rate-limit.mjs' {
  export type ProviderThrottleSource =
    | 'local_window'
    | 'local_rps'
    | 'local_queue'
    | 'upstream_429';

  export interface SharedProviderRateLimitPolicy {
    requestsPerSecond?: number;
    minIntervalMs?: number;
    maxDelayMs?: number;
    maxRequests?: number;
    windowMs?: number;
    minCooldownSeconds?: number;
    defaultCooldownSeconds?: number;
    maxCooldownSeconds?: number;
    windowSweepInterval?: number;
    windowStateMaxSize?: number;
  }

  export interface ProviderLimiterAcquireOptions {
    scopeKey?: string;
  }

  export interface ProviderLimiterAcquireResult {
    delayMs: number;
    scopeKey: string;
  }

  export interface ProviderLimiter {
    policyName: string;
    acquire(options?: ProviderLimiterAcquireOptions): Promise<ProviderLimiterAcquireResult>;
    reserveDelayMs(scopeKey?: string, nowMs?: number): number;
    applyCooldown(
      retryAfterSeconds: number,
      source?: ProviderThrottleSource,
      nowMs?: number
    ): number;
    consumeRateLimitHeaders(
      headers: Headers | null | undefined,
      source?: ProviderThrottleSource
    ): number;
    getCooldownRemainingSeconds(nowMs?: number): number;
    resolveRetryAfterSeconds(headers: Headers | null | undefined, nowMs?: number): number;
    reset(): void;
  }

  export class ProviderThrottleError extends Error {
    constructor(params: {
      policyName: string;
      source: ProviderThrottleSource;
      retryAfterSeconds: number;
      message: string;
      scopeKey?: string;
      delayMs?: number;
    });
    policyName: string;
    source: ProviderThrottleSource;
    retryAfterSeconds: number;
    scopeKey: string;
    delayMs: number;
  }

  export function parseRetryAfterSeconds(
    value: string | null | undefined,
    nowMs: number,
    options?: SharedProviderRateLimitPolicy
  ): number | null;

  export function createProviderLimiter(
    policyName: string,
    policy: SharedProviderRateLimitPolicy,
    options?: {
      now?: () => number;
      sleep?: (delayMs: number) => Promise<void>;
      onEvent?: (event: unknown) => void;
    }
  ): ProviderLimiter;
}

declare module '../../../shared/provider-rate-limit.mjs' {
  export type ProviderThrottleSource =
    | 'local_window'
    | 'local_rps'
    | 'local_queue'
    | 'upstream_429';

  export interface SharedProviderRateLimitPolicy {
    requestsPerSecond?: number;
    minIntervalMs?: number;
    maxDelayMs?: number;
    maxRequests?: number;
    windowMs?: number;
    minCooldownSeconds?: number;
    defaultCooldownSeconds?: number;
    maxCooldownSeconds?: number;
    windowSweepInterval?: number;
    windowStateMaxSize?: number;
  }

  export interface ProviderLimiterAcquireOptions {
    scopeKey?: string;
  }

  export interface ProviderLimiterAcquireResult {
    delayMs: number;
    scopeKey: string;
  }

  export interface ProviderLimiter {
    policyName: string;
    acquire(options?: ProviderLimiterAcquireOptions): Promise<ProviderLimiterAcquireResult>;
    reserveDelayMs(scopeKey?: string, nowMs?: number): number;
    applyCooldown(
      retryAfterSeconds: number,
      source?: ProviderThrottleSource,
      nowMs?: number
    ): number;
    consumeRateLimitHeaders(
      headers: Headers | null | undefined,
      source?: ProviderThrottleSource
    ): number;
    getCooldownRemainingSeconds(nowMs?: number): number;
    resolveRetryAfterSeconds(headers: Headers | null | undefined, nowMs?: number): number;
    reset(): void;
  }

  export class ProviderThrottleError extends Error {
    constructor(params: {
      policyName: string;
      source: ProviderThrottleSource;
      retryAfterSeconds: number;
      message: string;
      scopeKey?: string;
      delayMs?: number;
    });
    policyName: string;
    source: ProviderThrottleSource;
    retryAfterSeconds: number;
    scopeKey: string;
    delayMs: number;
  }

  export function parseRetryAfterSeconds(
    value: string | null | undefined,
    nowMs: number,
    options?: SharedProviderRateLimitPolicy
  ): number | null;

  export function createProviderLimiter(
    policyName: string,
    policy: SharedProviderRateLimitPolicy,
    options?: {
      now?: () => number;
      sleep?: (delayMs: number) => Promise<void>;
      onEvent?: (event: unknown) => void;
    }
  ): ProviderLimiter;
}

declare module '*.mjs' {
  export function handleRequest(
    request: Request,
    env: Record<string, unknown>,
    fetchImpl?: typeof fetch
  ): Promise<Response>;
}
