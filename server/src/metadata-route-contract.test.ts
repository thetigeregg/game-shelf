import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleRequest } from '../../worker/src/index.mjs';

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
}

function fetchStub(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url =
    input instanceof URL
      ? input.href
      : typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : '';
  const parsedUrl = new URL(url);

  if (url.includes('id.twitch.tv/oauth2/token')) {
    return Promise.resolve(
      createJsonResponse({
        access_token: 'stub-token',
        expires_in: 3600
      })
    );
  }

  if (url.includes('/v4/games')) {
    const body = typeof init?.body === 'string' ? init.body : '';

    if (body.includes('where id =')) {
      return Promise.resolve(
        createJsonResponse([
          {
            id: 1,
            name: 'Stub Game',
            first_release_date: 0,
            platforms: []
          }
        ])
      );
    }

    return Promise.resolve(createJsonResponse([]));
  }

  if (url.includes('/v4/platforms')) {
    return Promise.resolve(createJsonResponse([]));
  }

  if (url.includes('/v4/popularity_types')) {
    return Promise.resolve(createJsonResponse([]));
  }

  if (url.includes('/v4/popularity_primitives')) {
    return Promise.resolve(createJsonResponse([]));
  }

  if (parsedUrl.hostname === 'thegamesdb.net') {
    return Promise.resolve(
      createJsonResponse({
        data: {
          games: [],
          boxart: {
            base_url: {
              small: '',
              thumb: ''
            }
          }
        }
      })
    );
  }

  return Promise.resolve(createJsonResponse({}));
}

function sampleUrlForServerProxyPath(path: string): string {
  const normalizedPath = path.replace(':id', '1');

  if (normalizedPath === '/v1/games/search') {
    return `${normalizedPath}?q=halo`;
  }

  if (normalizedPath === '/v1/images/boxart/search') {
    return `${normalizedPath}?q=halo`;
  }

  if (normalizedPath === '/v1/popularity/primitives') {
    return `${normalizedPath}?popularityTypeId=1`;
  }

  return normalizedPath;
}

void test('all server metadata proxy routes are implemented by worker handler', async () => {
  const indexSource = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
  const proxyGetMatches = [
    ...indexSource.matchAll(/app\.get\('([^']+)',\s*proxyMetadataToWorker\);/g)
  ].map((match) => match[1]);
  const routeBlocks = [...indexSource.matchAll(/app\.route\(\{[\s\S]*?\}\);/g)];
  const proxyRouteMatches = routeBlocks
    .map((match) => match[0])
    .filter((block) => /handler:\s*proxyMetadataToWorker/.test(block))
    .map((block) => block.match(/url:\s*'([^']+)'/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => match[1]);
  const proxyPaths = [...proxyGetMatches, ...proxyRouteMatches].filter(
    (value, index, all) => all.indexOf(value) === index
  );

  assert.ok(proxyPaths.length > 0, 'Expected at least one worker-proxied route in server index.');

  const workerEnv = {
    TWITCH_CLIENT_ID: 'stub-client',
    TWITCH_CLIENT_SECRET: 'stub-secret',
    THEGAMESDB_API_KEY: 'stub-gamesdb'
  };

  for (const path of proxyPaths) {
    const request = new Request(`http://game-shelf.local${sampleUrlForServerProxyPath(path)}`, {
      method: 'GET'
    });

    const response = await handleRequest(request, workerEnv, fetchStub, () => Date.now());

    assert.notEqual(
      response.status,
      404,
      `Expected worker to support server-proxied route ${path} (received 404).`
    );
  }
});
