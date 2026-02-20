import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isAuthorizedMutatingRequest, shouldRequireAuth } from './request-security.js';

test('shouldRequireAuth protects all mutating HTTP methods by default', () => {
  assert.equal(shouldRequireAuth('GET'), false);
  assert.equal(shouldRequireAuth('HEAD'), false);
  assert.equal(shouldRequireAuth('OPTIONS'), false);
  assert.equal(shouldRequireAuth('POST'), true);
  assert.equal(shouldRequireAuth('PUT'), true);
  assert.equal(shouldRequireAuth('PATCH'), true);
  assert.equal(shouldRequireAuth('DELETE'), true);
  assert.equal(shouldRequireAuth('TRACE'), true);
  assert.equal(shouldRequireAuth(''), true);
});

test('isAuthorizedMutatingRequest accepts API token bearer auth', () => {
  assert.equal(
    isAuthorizedMutatingRequest({
      requireAuth: true,
      apiToken: 'api-secret',
      clientWriteTokens: ['device-a'],
      authorizationHeader: 'Bearer api-secret',
      clientWriteTokenHeader: undefined
    }),
    true
  );
});

test('isAuthorizedMutatingRequest accepts client write token auth', () => {
  assert.equal(
    isAuthorizedMutatingRequest({
      requireAuth: true,
      apiToken: 'api-secret',
      clientWriteTokens: ['device-a', 'device-b'],
      authorizationHeader: undefined,
      clientWriteTokenHeader: 'device-b'
    }),
    true
  );
});

test('isAuthorizedMutatingRequest rejects missing or invalid auth when required', () => {
  assert.equal(
    isAuthorizedMutatingRequest({
      requireAuth: true,
      apiToken: 'api-secret',
      clientWriteTokens: ['device-a'],
      authorizationHeader: undefined,
      clientWriteTokenHeader: undefined
    }),
    false
  );

  assert.equal(
    isAuthorizedMutatingRequest({
      requireAuth: true,
      apiToken: 'api-secret',
      clientWriteTokens: ['device-a'],
      authorizationHeader: 'Bearer wrong-secret',
      clientWriteTokenHeader: 'wrong-device'
    }),
    false
  );
});

test('server route inventory remains audited and mutating routes require auth', async () => {
  const routeSourceFiles = [
    './index.ts',
    './sync.ts',
    './image-cache.ts',
    './hltb-cache.ts',
    './manuals.ts',
    './cache-observability.ts'
  ];
  const routeRegex = /app\.(get|post|put|patch|delete|options|head)\(\s*'([^']+)'/g;
  const discoveredRoutes: Array<{ method: string; path: string }> = [];

  for (const relativePath of routeSourceFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');

    for (const match of source.matchAll(routeRegex)) {
      discoveredRoutes.push({
        method: match[1].toUpperCase(),
        path: match[2]
      });
    }
  }

  const uniqueSortedRoutes = [
    ...new Map(discoveredRoutes.map((item) => [`${item.method} ${item.path}`, item])).values()
  ].sort((left, right) =>
    `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`)
  );

  const expectedRoutes: Array<{ method: string; path: string }> = [
    { method: 'GET', path: '/v1/cache/stats' },
    { method: 'GET', path: '/v1/games/:id' },
    { method: 'GET', path: '/v1/games/search' },
    { method: 'GET', path: '/v1/health' },
    { method: 'GET', path: '/v1/hltb/search' },
    { method: 'GET', path: '/v1/images/boxart/search' },
    { method: 'GET', path: '/v1/images/proxy' },
    { method: 'GET', path: '/v1/manuals/resolve' },
    { method: 'GET', path: '/v1/manuals/search' },
    { method: 'GET', path: '/v1/platforms' },
    { method: 'GET', path: '/v1/popularity/primitives' },
    { method: 'GET', path: '/v1/popularity/types' },
    { method: 'POST', path: '/v1/images/cache/purge' },
    { method: 'POST', path: '/v1/manuals/refresh' },
    { method: 'POST', path: '/v1/sync/pull' },
    { method: 'POST', path: '/v1/sync/push' }
  ];

  assert.deepEqual(uniqueSortedRoutes, expectedRoutes);

  const mutatingRoutes = uniqueSortedRoutes.filter(
    (item) => !['GET', 'HEAD', 'OPTIONS'].includes(item.method)
  );
  assert.ok(mutatingRoutes.length > 0, 'Expected at least one mutating route.');

  for (const route of mutatingRoutes) {
    assert.equal(
      shouldRequireAuth(route.method),
      true,
      `Expected ${route.method} ${route.path} to require auth.`
    );
  }
});
