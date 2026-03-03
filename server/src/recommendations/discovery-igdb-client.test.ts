import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscoveryIgdbClient } from './discovery-igdb-client.js';

void test('discovery popular query uses game_type and excludes deprecated category filters', async () => {
  const gameRequests: string[] = [];
  const fetchMock: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('id.twitch.tv/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200
        })
      );
    }

    if (url.includes('/v4/game_types')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 1, type: 'Main Game' }]), { status: 200 })
      );
    }

    if (url.includes('/v4/games')) {
      const body = typeof init?.body === 'string' ? init.body : '';
      gameRequests.push(body);
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const client = new DiscoveryIgdbClient({
    twitchClientId: 'client',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    maxRequestsPerSecond: 20,
    fetchImpl: fetchMock
  });

  await client.fetchDiscoveryCandidatesBySource({
    source: 'popular',
    poolSize: 1,
    preferredPlatformIds: []
  });

  assert.equal(gameRequests.length, 1);
  const query = gameRequests[0] ?? '';
  assert.match(query, /\bgame_type = \(1\)/);
  assert.doesNotMatch(query, /\bcategory\b/);
  assert.match(query, /sort total_rating_count desc;/);
  assert.match(query, /parent_game = null/);
  assert.match(query, /version_parent = null/);
});

void test('discovery recent query applies quality and release window filters', async () => {
  const gameRequests: string[] = [];
  const fetchMock: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('id.twitch.tv/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200
        })
      );
    }

    if (url.includes('/v4/game_types')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 1, type: 'Main Game' }]), { status: 200 })
      );
    }

    if (url.includes('/v4/games')) {
      const body = typeof init?.body === 'string' ? init.body : '';
      gameRequests.push(body);
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const client = new DiscoveryIgdbClient({
    twitchClientId: 'client',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    maxRequestsPerSecond: 20,
    fetchImpl: fetchMock
  });

  await client.fetchDiscoveryCandidatesBySource({
    source: 'recent',
    poolSize: 1,
    preferredPlatformIds: []
  });

  assert.equal(gameRequests.length, 1);
  const query = gameRequests[0] ?? '';
  assert.match(query, /\bfirst_release_date <= \d+/);
  assert.match(query, /\(total_rating_count >= 25 \| aggregated_rating_count >= 25\)/);
  assert.match(query, /sort first_release_date desc;/);
  assert.match(query, /\bgame_type = \(1\)/);
  assert.doesNotMatch(query, /\bcategory\b/);
});
