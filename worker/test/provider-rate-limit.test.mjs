import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProviderLimiter,
  parseRetryAfterSeconds,
  ProviderThrottleError,
} from '../../shared/provider-rate-limit.mjs';

test('parseRetryAfterSeconds handles empty, invalid, and clamped values', () => {
  const nowMs = Date.UTC(2026, 0, 1, 0, 0, 0);

  assert.equal(parseRetryAfterSeconds(null, nowMs), null);
  assert.equal(parseRetryAfterSeconds('not-a-date', nowMs), null);
  assert.equal(
    parseRetryAfterSeconds('0', nowMs, { minCooldownSeconds: '20', maxCooldownSeconds: '60' }),
    20
  );
  assert.equal(
    parseRetryAfterSeconds('120', nowMs, { minCooldownSeconds: 1, maxCooldownSeconds: 30 }),
    30
  );
  assert.equal(
    parseRetryAfterSeconds('Thu, 01 Jan 2026 00:00:40 GMT', nowMs, {
      minCooldownSeconds: 5,
      maxCooldownSeconds: 60,
    }),
    40
  );
});

test('provider limiter applies cooldown from headers and blocks acquires until reset', async () => {
  const events = [];
  let nowMs = 1_000;
  const limiter = createProviderLimiter(
    'igdb',
    {
      defaultCooldownSeconds: 15,
      minCooldownSeconds: 5,
      maxCooldownSeconds: 30,
    },
    {
      now: () => nowMs,
      onEvent: (event) => events.push(event),
    }
  );

  assert.equal(limiter.consumeRateLimitHeaders(new Headers(), 'upstream_429'), 15);
  assert.equal(limiter.getCooldownRemainingSeconds(), 15);

  await assert.rejects(
    limiter.acquire(),
    /** @returns {boolean} */ (error) =>
      error instanceof ProviderThrottleError &&
      error.source === 'upstream_429' &&
      error.retryAfterSeconds === 15 &&
      error.scopeKey === 'global'
  );

  nowMs += 16_000;
  assert.equal(limiter.getCooldownRemainingSeconds(), 0);
  limiter.reset();
  const acquired = await limiter.acquire();
  assert.equal(acquired.delayMs, 0);
  assert.equal(acquired.scopeKey, 'global');
  assert.equal(typeof acquired.release, 'function');

  assert.equal(
    events.some(
      (event) =>
        event.type === 'cooldown_activated' &&
        event.policyName === 'igdb' &&
        event.cooldownSeconds === 15
    ),
    true
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === 'blocked' &&
        event.source === 'upstream_429' &&
        event.retryAfterSeconds === 15
    ),
    true
  );
});

test('provider limiter enforces local request pacing and queue limits', async () => {
  const pacingSleeps = [];
  const pacingEvents = [];
  let nowMs = 0;
  const pacingLimiter = createProviderLimiter(
    'mobygames',
    {
      requestsPerSecond: 2,
    },
    {
      now: () => nowMs,
      sleep: async (delayMs) => {
        pacingSleeps.push(delayMs);
        nowMs += delayMs;
      },
      onEvent: (event) => pacingEvents.push(event),
    }
  );

  const firstAcquire = await pacingLimiter.acquire({ scopeKey: 'boxart' });
  assert.equal(firstAcquire.delayMs, 0);
  assert.equal(firstAcquire.scopeKey, 'boxart');
  assert.equal(typeof firstAcquire.release, 'function');
  firstAcquire.release();

  const secondAcquire = await pacingLimiter.acquire({ scopeKey: 'boxart' });
  assert.equal(secondAcquire.delayMs, 500);
  assert.equal(secondAcquire.scopeKey, 'boxart');
  assert.equal(typeof secondAcquire.release, 'function');
  secondAcquire.release();
  assert.deepEqual(pacingSleeps, [500]);

  const queueEvents = [];
  const queueLimiter = createProviderLimiter(
    'mobygames',
    {
      requestsPerSecond: 2,
      maxDelayMs: 200,
    },
    {
      now: () => 0,
      onEvent: (event) => queueEvents.push(event),
    }
  );

  assert.equal(queueLimiter.reserveDelayMs('boxart', 0), 0);
  nowMs = 0;
  assert.throws(
    () => queueLimiter.reserveDelayMs('boxart', nowMs),
    /** @returns {boolean} */ (error) =>
      error instanceof ProviderThrottleError &&
      error.source === 'local_queue' &&
      error.delayMs === 500 &&
      error.scopeKey === 'boxart'
  );

  assert.equal(
    pacingEvents.some(
      (event) => event.type === 'waiting' && event.source === 'local_rps' && event.delayMs === 500
    ),
    true
  );
  assert.equal(
    queueEvents.some(
      (event) => event.type === 'blocked' && event.source === 'local_queue' && event.delayMs === 500
    ),
    true
  );
});

test('provider limiter does not consume window capacity when queue admission is rejected', async () => {
  let nowMs = 0;
  const limiter = createProviderLimiter(
    'mobygames',
    {
      requestsPerSecond: 2,
      maxDelayMs: 200,
      maxRequests: 2,
      windowMs: 1_000,
      minCooldownSeconds: 1,
      maxCooldownSeconds: 60,
    },
    {
      now: () => nowMs,
    }
  );

  const firstAcquire = await limiter.acquire({ scopeKey: 'boxart' });
  assert.equal(firstAcquire.delayMs, 0);
  assert.equal(firstAcquire.scopeKey, 'boxart');
  firstAcquire.release();

  await assert.rejects(
    limiter.acquire({ scopeKey: 'boxart' }),
    /** @returns {boolean} */ (error) =>
      error instanceof ProviderThrottleError &&
      error.source === 'local_queue' &&
      error.delayMs === 500
  );

  nowMs = 500;
  const secondAcquire = await limiter.acquire({ scopeKey: 'boxart' });
  assert.equal(secondAcquire.delayMs, 0);
  assert.equal(secondAcquire.scopeKey, 'boxart');
  secondAcquire.release();
});

test('provider limiter enforces local window limits and evicts expired entries', async () => {
  let nowMs = 0;
  const limiter = createProviderLimiter(
    'metadata',
    {
      maxRequests: 2,
      windowMs: 1_000,
      minCooldownSeconds: 1,
      maxCooldownSeconds: 60,
      windowSweepInterval: 1,
      windowStateMaxSize: 1,
    },
    {
      now: () => nowMs,
      sleep: async () => undefined,
    }
  );

  const firstAcquire = await limiter.acquire({ scopeKey: 'search' });
  assert.equal(firstAcquire.delayMs, 0);
  assert.equal(firstAcquire.scopeKey, 'search');
  firstAcquire.release();

  const secondAcquire = await limiter.acquire({ scopeKey: 'search' });
  assert.equal(secondAcquire.delayMs, 0);
  assert.equal(secondAcquire.scopeKey, 'search');
  secondAcquire.release();

  await assert.rejects(
    limiter.acquire({ scopeKey: 'search' }),
    /** @returns {boolean} */ (error) =>
      error instanceof ProviderThrottleError &&
      error.source === 'local_window' &&
      error.retryAfterSeconds === 1
  );

  nowMs = 1_500;
  const thirdAcquire = await limiter.acquire({ scopeKey: 'search' });
  assert.equal(thirdAcquire.delayMs, 0);
  assert.equal(thirdAcquire.scopeKey, 'search');
  thirdAcquire.release();
});

test('provider limiter re-checks cooldown after waiting for local pacing', async () => {
  let nowMs = 0;
  let sleepCalls = 0;
  const limiter = createProviderLimiter(
    'igdb',
    {
      requestsPerSecond: 2,
      minCooldownSeconds: 1,
      defaultCooldownSeconds: 15,
      maxCooldownSeconds: 60,
    },
    {
      now: () => nowMs,
      sleep: async (delayMs) => {
        sleepCalls += 1;
        if (sleepCalls === 1) {
          nowMs = 100;
          limiter.applyCooldown(5, 'upstream_429', nowMs);
        }
        nowMs += delayMs;
      },
    }
  );

  const firstAcquire = await limiter.acquire({ scopeKey: 'search' });
  assert.equal(firstAcquire.delayMs, 0);
  assert.equal(firstAcquire.scopeKey, 'search');
  firstAcquire.release();

  await assert.rejects(
    limiter.acquire({ scopeKey: 'search' }),
    /** @returns {boolean} */ (error) =>
      error instanceof ProviderThrottleError &&
      error.source === 'upstream_429' &&
      error.retryAfterSeconds === 5 &&
      error.delayMs === 500
  );
});

test('provider limiter caps concurrent requests until a slot is released', async () => {
  const limiter = createProviderLimiter('igdb', {
    maxConcurrent: 2,
  });

  const first = await limiter.acquire({ scopeKey: 'search' });
  const second = await limiter.acquire({ scopeKey: 'search' });

  let thirdResolved = false;
  const thirdPromise = limiter.acquire({ scopeKey: 'search' }).then((lease) => {
    thirdResolved = true;
    return lease;
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(thirdResolved, false);

  first.release();
  const third = await thirdPromise;
  assert.equal(third.scopeKey, 'search');

  second.release();
  third.release();
});

test('provider limiter reset wakes acquires waiting on concurrency limits', async () => {
  const limiter = createProviderLimiter('igdb', {
    maxConcurrent: 1,
  });

  const first = await limiter.acquire({ scopeKey: 'search' });

  let secondResolved = false;
  const secondPromise = limiter.acquire({ scopeKey: 'search' }).then((lease) => {
    secondResolved = true;
    return lease;
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(secondResolved, false);

  limiter.reset();

  const second = await secondPromise;
  assert.equal(secondResolved, true);
  assert.equal(second.scopeKey, 'search');

  first.release();
  second.release();
});
