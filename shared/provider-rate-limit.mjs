export class ProviderThrottleError extends Error {
  constructor({
    policyName,
    source,
    retryAfterSeconds,
    message,
    scopeKey = 'global',
    delayMs = 0,
  }) {
    super(message);
    this.name = 'ProviderThrottleError';
    this.policyName = policyName;
    this.source = source;
    this.retryAfterSeconds = retryAfterSeconds;
    this.scopeKey = scopeKey;
    this.delayMs = delayMs;
  }
}

export function parseRetryAfterSeconds(value, nowMs, options = {}) {
  if (!value) {
    return null;
  }

  const minSeconds = normalizePositiveInteger(options.minCooldownSeconds, 1);
  const maxSeconds = normalizePositiveInteger(options.maxCooldownSeconds, 60);
  const normalizedValue = String(value).trim();
  const seconds = Number.parseInt(normalizedValue, 10);

  if (Number.isInteger(seconds) && seconds >= 0) {
    return clampCooldownSeconds(seconds, minSeconds, maxSeconds);
  }

  const dateMs = Date.parse(normalizedValue);

  if (Number.isNaN(dateMs)) {
    return null;
  }

  const deltaSeconds = Math.ceil(Math.max(dateMs - nowMs, 0) / 1000);
  return clampCooldownSeconds(deltaSeconds, minSeconds, maxSeconds);
}

export function createProviderLimiter(policyName, policy, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const sleep =
    typeof options.sleep === 'function'
      ? options.sleep
      : (delayMs) =>
          new Promise((resolve) => {
            setTimeout(resolve, delayMs);
          });
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => undefined;
  const state = {
    cooldownUntilMs: 0,
    nextRequestAtMs: 0,
    windowEntries: new Map(),
    sweepCounter: 0,
    activeRequests: 0,
    concurrencyWaiters: [],
  };

  function sweepWindowEntries(nowMs) {
    state.sweepCounter += 1;
    const maxSize = normalizePositiveInteger(policy.windowStateMaxSize, 5000);
    const sweepInterval = normalizePositiveInteger(policy.windowSweepInterval, 250);
    const shouldSweepByInterval = state.sweepCounter % sweepInterval === 0;

    if (!shouldSweepByInterval && state.windowEntries.size <= maxSize) {
      return;
    }

    const windowMs = normalizePositiveInteger(policy.windowMs, 0);
    if (windowMs <= 0) {
      state.windowEntries.clear();
      return;
    }

    for (const [scopeKey, entry] of state.windowEntries.entries()) {
      if (nowMs - entry.startedAtMs > windowMs) {
        state.windowEntries.delete(scopeKey);
      }
    }
  }

  function getCooldownRemainingSeconds(nowMs = now()) {
    if (state.cooldownUntilMs <= nowMs) {
      return 0;
    }

    return Math.max(1, Math.ceil((state.cooldownUntilMs - nowMs) / 1000));
  }

  function applyCooldown(retryAfterSeconds, source = 'upstream_429', nowMs = now()) {
    const minSeconds = normalizePositiveInteger(policy.minCooldownSeconds, 1);
    const maxSeconds = normalizePositiveInteger(policy.maxCooldownSeconds, 60);
    const clampedSeconds = clampCooldownSeconds(retryAfterSeconds, minSeconds, maxSeconds);
    const cooldownUntilMs = nowMs + clampedSeconds * 1000;
    state.cooldownUntilMs = Math.max(state.cooldownUntilMs, cooldownUntilMs);
    const remainingSeconds = getCooldownRemainingSeconds(nowMs);

    onEvent({
      type: 'cooldown_activated',
      policyName,
      source,
      cooldownSeconds: remainingSeconds,
      nowMs,
    });

    return remainingSeconds;
  }

  function resolveRetryAfterSeconds(headers, nowMs = now()) {
    const parsed = parseRetryAfterSeconds(headers?.get('Retry-After') ?? null, nowMs, policy);
    return parsed ?? normalizePositiveInteger(policy.defaultCooldownSeconds, 1);
  }

  function buildError(source, retryAfterSeconds, scopeKey, delayMs = 0) {
    return new ProviderThrottleError({
      policyName,
      source,
      retryAfterSeconds,
      scopeKey,
      delayMs,
      message: `Rate limit exceeded. Retry after ${String(retryAfterSeconds)}s.`,
    });
  }

  function releaseConcurrencySlot() {
    if (state.activeRequests > 0) {
      state.activeRequests -= 1;
    }

    const nextWaiter = state.concurrencyWaiters.shift();
    nextWaiter?.();
  }

  async function reserveConcurrencySlot() {
    const maxConcurrent = normalizePositiveInteger(policy.maxConcurrent, 0);
    if (maxConcurrent <= 0) {
      return () => undefined;
    }

    while (state.activeRequests >= maxConcurrent) {
      await new Promise((resolve) => {
        state.concurrencyWaiters.push(resolve);
      });
    }

    state.activeRequests += 1;
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      releaseConcurrencySlot();
    };
  }

  function reserveWindowSlot(scopeKey, nowMs) {
    const maxRequests = normalizePositiveInteger(policy.maxRequests, 0);
    const windowMs = normalizePositiveInteger(policy.windowMs, 0);

    if (maxRequests <= 0 || windowMs <= 0) {
      return null;
    }

    sweepWindowEntries(nowMs);
    const key = scopeKey ?? 'global';
    const entry = state.windowEntries.get(key);

    if (!entry || nowMs - entry.startedAtMs > windowMs) {
      state.windowEntries.set(key, { startedAtMs: nowMs, count: 1 });
      return null;
    }

    if (entry.count >= maxRequests) {
      const retryAfterSeconds = clampCooldownSeconds(
        Math.ceil(Math.max(windowMs - (nowMs - entry.startedAtMs), 0) / 1000),
        normalizePositiveInteger(policy.minCooldownSeconds, 1),
        normalizePositiveInteger(policy.maxCooldownSeconds, 60)
      );
      return buildError('local_window', retryAfterSeconds, key);
    }

    entry.count += 1;
    return null;
  }

  async function acquire(acquireOptions = {}) {
    const scopeKey = acquireOptions.scopeKey ?? 'global';
    const nowMs = now();
    const cooldownRemainingSeconds = getCooldownRemainingSeconds(nowMs);

    if (cooldownRemainingSeconds > 0) {
      onEvent({
        type: 'blocked',
        policyName,
        source: 'upstream_429',
        retryAfterSeconds: cooldownRemainingSeconds,
        scopeKey,
        nowMs,
      });
      throw buildError('upstream_429', cooldownRemainingSeconds, scopeKey);
    }

    const delayMs = reserveDelayMs(scopeKey, nowMs);

    if (delayMs > 0) {
      onEvent({
        type: 'waiting',
        policyName,
        source: 'local_rps',
        delayMs,
        scopeKey,
        nowMs,
      });
      await sleep(delayMs);
    }

    const settledNowMs = now();
    const settledCooldownRemainingSeconds = getCooldownRemainingSeconds(settledNowMs);

    if (settledCooldownRemainingSeconds > 0) {
      onEvent({
        type: 'blocked',
        policyName,
        source: 'upstream_429',
        retryAfterSeconds: settledCooldownRemainingSeconds,
        scopeKey,
        nowMs: settledNowMs,
      });
      throw buildError('upstream_429', settledCooldownRemainingSeconds, scopeKey, delayMs);
    }

    const windowError = reserveWindowSlot(scopeKey, settledNowMs);
    if (windowError) {
      onEvent({
        type: 'blocked',
        policyName,
        source: 'local_window',
        retryAfterSeconds: windowError.retryAfterSeconds,
        scopeKey,
        nowMs: settledNowMs,
      });
      throw windowError;
    }

    const release = await reserveConcurrencySlot();
    return { delayMs, scopeKey, release };
  }

  function reserveDelayMs(scopeKey = 'global', nowMs = now()) {
    const minIntervalMs = resolveMinIntervalMs(policy);
    if (minIntervalMs <= 0) {
      return 0;
    }

    const delayMs = Math.max(0, state.nextRequestAtMs - nowMs);
    const maxDelayMs = normalizePositiveInteger(policy.maxDelayMs, 0);

    if (maxDelayMs > 0 && delayMs > maxDelayMs) {
      onEvent({
        type: 'blocked',
        policyName,
        source: 'local_queue',
        retryAfterSeconds: Math.max(1, Math.ceil(delayMs / 1000)),
        delayMs,
        scopeKey,
        nowMs,
      });
      throw buildError('local_queue', Math.max(1, Math.ceil(delayMs / 1000)), scopeKey, delayMs);
    }

    state.nextRequestAtMs = Math.max(nowMs, state.nextRequestAtMs) + minIntervalMs;
    return delayMs;
  }

  function consumeRateLimitHeaders(headers, source = 'upstream_429', nowMs = now()) {
    const retryAfterSeconds = resolveRetryAfterSeconds(headers, nowMs);
    return applyCooldown(retryAfterSeconds, source, nowMs);
  }

  function reset() {
    state.cooldownUntilMs = 0;
    state.nextRequestAtMs = 0;
    state.windowEntries.clear();
    state.sweepCounter = 0;
    state.activeRequests = 0;
    state.concurrencyWaiters.length = 0;
  }

  return {
    policyName,
    acquire,
    applyCooldown,
    consumeRateLimitHeaders,
    getCooldownRemainingSeconds,
    reserveDelayMs,
    resolveRetryAfterSeconds,
    reset,
  };
}

function resolveMinIntervalMs(policy) {
  const minIntervalMs = normalizePositiveInteger(policy.minIntervalMs, 0);
  if (minIntervalMs > 0) {
    return minIntervalMs;
  }

  const requestsPerSecond = Number.parseFloat(String(policy.requestsPerSecond ?? '0'));
  if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0) {
    return 0;
  }

  return Math.ceil(1000 / requestsPerSecond);
}

function clampCooldownSeconds(value, minSeconds, maxSeconds) {
  const normalizedValue = normalizePositiveInteger(value, minSeconds);
  return Math.max(minSeconds, Math.min(normalizedValue, maxSeconds));
}

function normalizePositiveInteger(value, fallback) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  return fallback;
}
