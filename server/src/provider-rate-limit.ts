import * as sharedProviderRateLimitModule from '../../shared/provider-rate-limit.mjs';

export type ProviderThrottleSource = 'local_window' | 'local_rps' | 'local_queue' | 'upstream_429';

export interface SharedProviderRateLimitPolicy {
  requestsPerSecond?: number;
  minIntervalMs?: number;
  maxDelayMs?: number;
  maxRequests?: number;
  windowMs?: number;
  maxConcurrent?: number;
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
  release: () => void;
}

export interface ProviderLimiterEvent {
  type: 'waiting' | 'blocked' | 'cooldown_activated';
  policyName: string;
  source: ProviderThrottleSource;
  retryAfterSeconds?: number;
  cooldownSeconds?: number;
  delayMs?: number;
  scopeKey?: string;
  nowMs: number;
}

export interface CreateProviderLimiterOptions {
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  onEvent?: (event: ProviderLimiterEvent) => void;
}

export interface ProviderThrottleError extends Error {
  policyName: string;
  source: ProviderThrottleSource;
  retryAfterSeconds: number;
  scopeKey: string;
  delayMs: number;
}

export interface ProviderLimiter {
  policyName: string;
  acquire(options?: ProviderLimiterAcquireOptions): Promise<ProviderLimiterAcquireResult>;
  reserveDelayMs(scopeKey?: string, nowMs?: number): number;
  applyCooldown(retryAfterSeconds: number, source?: ProviderThrottleSource, nowMs?: number): number;
  consumeRateLimitHeaders(
    headers: Headers | null | undefined,
    source?: ProviderThrottleSource
  ): number;
  getCooldownRemainingSeconds(nowMs?: number): number;
  resolveRetryAfterSeconds(headers: Headers | null | undefined, nowMs?: number): number;
  reset(): void;
}

interface SharedProviderRateLimitModule {
  createProviderLimiter: (
    policyName: string,
    policy: SharedProviderRateLimitPolicy,
    options?: CreateProviderLimiterOptions
  ) => ProviderLimiter;
  parseRetryAfterSeconds: (
    value: string | null | undefined,
    nowMs: number,
    options?: SharedProviderRateLimitPolicy
  ) => number | null;
  ProviderThrottleError: new (params: {
    policyName: string;
    source: ProviderThrottleSource;
    retryAfterSeconds: number;
    message: string;
    scopeKey?: string;
    delayMs?: number;
  }) => ProviderThrottleError;
}

const sharedProviderRateLimit =
  sharedProviderRateLimitModule as unknown as SharedProviderRateLimitModule;

export const createProviderLimiter = (
  policyName: string,
  policy: SharedProviderRateLimitPolicy,
  options?: CreateProviderLimiterOptions
): ProviderLimiter => sharedProviderRateLimit.createProviderLimiter(policyName, policy, options);

export const parseRetryAfterSeconds = (
  value: string | null | undefined,
  nowMs: number,
  options?: SharedProviderRateLimitPolicy
): number | null => sharedProviderRateLimit.parseRetryAfterSeconds(value, nowMs, options);

export const ProviderThrottleError = sharedProviderRateLimit.ProviderThrottleError;
