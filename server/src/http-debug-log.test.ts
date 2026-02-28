import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import {
  isDebugHttpLogsEnabled,
  logUpstreamRequest,
  logUpstreamResponse,
  sanitizeHeadersForDebugLogs,
  sanitizeUrlForDebugLogs
} from './http-debug-log.js';

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void | Promise<void>
): Promise<void> {
  const original = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    original.set(key, process.env[key]);
    if (typeof value === 'undefined') {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of original.entries()) {
      if (typeof value === 'undefined') {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  });
}

void test('isDebugHttpLogsEnabled returns false when DEBUG_HTTP_LOGS is not set', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: undefined }, () => {
    assert.equal(isDebugHttpLogsEnabled(), false);
  });
});

void test('isDebugHttpLogsEnabled returns true for truthy values', async () => {
  for (const value of ['1', 'true', 'yes', 'on', 'TRUE', 'YES', 'ON']) {
    await withEnv({ DEBUG_HTTP_LOGS: value }, () => {
      assert.equal(isDebugHttpLogsEnabled(), true, `expected true for ${value}`);
    });
  }
});

void test('isDebugHttpLogsEnabled returns false for falsy string values', async () => {
  for (const value of ['0', 'false', 'no', 'off', 'nope']) {
    await withEnv({ DEBUG_HTTP_LOGS: value }, () => {
      assert.equal(isDebugHttpLogsEnabled(), false, `expected false for ${value}`);
    });
  }
});

void test('sanitizeUrlForDebugLogs redacts sensitive query params', () => {
  const url = 'https://api.example.com/v2/games?title=Okami&api_key=secret123&limit=10';
  const sanitized = sanitizeUrlForDebugLogs(url);
  assert.match(sanitized, /api_key=%2A%2A%2A|api_key=\*\*\*/);
  assert.match(sanitized, /title=Okami/);
  assert.match(sanitized, /limit=10/);
  assert.doesNotMatch(sanitized, /secret123/);
});

void test('sanitizeUrlForDebugLogs returns input unchanged for invalid URLs', () => {
  const invalid = 'not a valid url';
  assert.equal(sanitizeUrlForDebugLogs(invalid), invalid);
});

void test('sanitizeUrlForDebugLogs redacts token and access_token params', () => {
  const url = 'https://api.example.com/endpoint?token=tok123&access_token=acc456';
  const sanitized = sanitizeUrlForDebugLogs(url);
  assert.doesNotMatch(sanitized, /tok123/);
  assert.doesNotMatch(sanitized, /acc456/);
});

void test('sanitizeHeadersForDebugLogs returns empty object for undefined headers', () => {
  const result = sanitizeHeadersForDebugLogs(undefined);
  assert.deepEqual(result, {});
});

void test('sanitizeHeadersForDebugLogs redacts sensitive header values', () => {
  const headers = new Headers({
    authorization: 'Bearer mysecrettoken',
    'x-api-key': 'keyvalue',
    'api-key': 'another-key',
    'content-type': 'application/json'
  });
  const result = sanitizeHeadersForDebugLogs(headers);
  assert.equal(result['authorization'], '***');
  assert.equal(result['x-api-key'], '***');
  assert.equal(result['api-key'], '***');
  assert.equal(result['content-type'], 'application/json');
});

void test('sanitizeHeadersForDebugLogs passes through non-sensitive headers', () => {
  const headers = { 'content-type': 'application/json', accept: 'text/html' };
  const result = sanitizeHeadersForDebugLogs(headers);
  assert.equal(result['content-type'], 'application/json');
  assert.equal(result['accept'], 'text/html');
});

void test('logUpstreamRequest does nothing when debug logs are disabled', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: undefined }, async () => {
    const app = Fastify({ logger: false });
    app.get('/test', (request, reply) => {
      logUpstreamRequest(request, { method: 'GET', url: 'https://example.com' });
      void reply.send({ ok: true });
    });

    const response = await app.inject({ method: 'GET', url: '/test' });
    assert.equal(response.statusCode, 200);
    await app.close();
  });
});

void test('logUpstreamRequest logs when debug is enabled', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: '1' }, async () => {
    const app = Fastify({ logger: false });
    const loggedMessages: unknown[] = [];

    app.get('/test', (request, reply) => {
      request.log = {
        info: (obj: unknown) => {
          loggedMessages.push(obj);
        }
      } as typeof request.log;
      logUpstreamRequest(request, {
        method: 'GET',
        url: 'https://api.example.com/v2/games?api_key=secret',
        headers: { authorization: 'Bearer tok' }
      });
      void reply.send({ ok: true });
    });

    await app.inject({ method: 'GET', url: '/test' });

    assert.equal(loggedMessages.length, 1);
    const msg = loggedMessages[0] as Record<string, unknown>;
    assert.equal(msg['msg'], 'upstream_http_request');
    assert.equal(msg['method'], 'GET');
    assert.doesNotMatch(String(msg['url']), /secret/);
    const headers = msg['headers'] as Record<string, string>;
    assert.equal(headers['authorization'], '***');

    await app.close();
  });
});

void test('logUpstreamResponse does nothing when debug logs are disabled', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: undefined }, async () => {
    const app = Fastify({ logger: false });
    app.get('/test', async (request, reply) => {
      await logUpstreamResponse(request, {
        method: 'GET',
        url: 'https://example.com',
        response: new Response('ok', { status: 200 })
      });
      void reply.send({ ok: true });
    });

    const response = await app.inject({ method: 'GET', url: '/test' });
    assert.equal(response.statusCode, 200);
    await app.close();
  });
});

void test('logUpstreamResponse logs JSON response body preview when debug is enabled', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: '1' }, async () => {
    const app = Fastify({ logger: false });
    const loggedMessages: unknown[] = [];

    app.get('/test', async (request, reply) => {
      request.log = {
        info: (obj: unknown) => {
          loggedMessages.push(obj);
        }
      } as typeof request.log;
      await logUpstreamResponse(request, {
        method: 'GET',
        url: 'https://api.example.com/v2/games?api_key=s3cr3t',
        response: new Response(JSON.stringify({ games: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      });
      void reply.send({ ok: true });
    });

    await app.inject({ method: 'GET', url: '/test' });

    assert.equal(loggedMessages.length, 1);
    const msg = loggedMessages[0] as Record<string, unknown>;
    assert.equal(msg['msg'], 'upstream_http_response');
    assert.equal(msg['status'], 200);
    assert.doesNotMatch(String(msg['url']), /s3cr3t/);
    assert.equal(typeof msg['bodyPreview'], 'string');

    await app.close();
  });
});

void test('logUpstreamResponse sets null bodyPreview for binary content type', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: '1' }, async () => {
    const app = Fastify({ logger: false });
    const loggedMessages: unknown[] = [];

    app.get('/test', async (request, reply) => {
      request.log = {
        info: (obj: unknown) => {
          loggedMessages.push(obj);
        }
      } as typeof request.log;
      await logUpstreamResponse(request, {
        method: 'GET',
        url: 'https://example.com/image.png',
        response: new Response(Buffer.from([0x89, 0x50]), {
          status: 200,
          headers: { 'content-type': 'image/png' }
        })
      });
      void reply.send({ ok: true });
    });

    await app.inject({ method: 'GET', url: '/test' });

    assert.equal(loggedMessages.length, 1);
    const msg = loggedMessages[0] as Record<string, unknown>;
    assert.equal(msg['bodyPreview'], null);

    await app.close();
  });
});
