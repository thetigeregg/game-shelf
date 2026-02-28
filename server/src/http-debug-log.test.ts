import assert from 'node:assert/strict';
import test from 'node:test';
import type { FastifyRequest } from 'fastify';
import {
  isDebugHttpLogsEnabled,
  logUpstreamRequest,
  logUpstreamResponse,
  sanitizeHeadersForDebugLogs,
  sanitizeUrlForDebugLogs
} from './http-debug-log.js';

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void>
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

  return fn().finally(() => {
    for (const [key, value] of original.entries()) {
      if (typeof value === 'undefined') {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  });
}

function makeMockRequest(): { request: FastifyRequest; logInfoCalls: unknown[] } {
  const logInfoCalls: unknown[] = [];
  const request = {
    log: {
      info: (data: unknown) => {
        logInfoCalls.push(data);
      },
      warn: () => {}
    }
  } as unknown as FastifyRequest;
  return { request, logInfoCalls };
}

void test('isDebugHttpLogsEnabled returns true for truthy values', async () => {
  for (const value of ['1', 'true', 'yes', 'on', 'TRUE', 'YES', 'ON', 'True']) {
    await withEnv({ DEBUG_HTTP_LOGS: value }, () => {
      assert.equal(isDebugHttpLogsEnabled(), true, `Expected true for DEBUG_HTTP_LOGS=${value}`);
      return Promise.resolve();
    });
  }
});

void test('isDebugHttpLogsEnabled returns false for falsy or absent values', async () => {
  for (const value of ['false', '0', 'no', 'off', '']) {
    await withEnv({ DEBUG_HTTP_LOGS: value }, () => {
      assert.equal(isDebugHttpLogsEnabled(), false, `Expected false for DEBUG_HTTP_LOGS=${value}`);
      return Promise.resolve();
    });
  }

  await withEnv({ DEBUG_HTTP_LOGS: undefined }, () => {
    assert.equal(isDebugHttpLogsEnabled(), false, 'Expected false when DEBUG_HTTP_LOGS not set');
    return Promise.resolve();
  });
});

void test('sanitizeUrlForDebugLogs redacts sensitive query params', () => {
  const url = 'https://api.example.com/search?q=game&api_key=SECRET123&other=value';
  const sanitized = sanitizeUrlForDebugLogs(url);
  assert.doesNotMatch(sanitized, /SECRET123/);
  assert.match(sanitized, /q=game/);
  assert.match(sanitized, /api_key=/);
});

void test('sanitizeUrlForDebugLogs redacts token and access_token params', () => {
  const url =
    'https://api.example.com/?token=tok123&access_token=acc456&apikey=k1&client_secret=cs1';
  const sanitized = sanitizeUrlForDebugLogs(url);
  assert.doesNotMatch(sanitized, /tok123/);
  assert.doesNotMatch(sanitized, /acc456/);
  assert.doesNotMatch(sanitized, /k1/);
  assert.doesNotMatch(sanitized, /cs1/);
});

void test('sanitizeUrlForDebugLogs returns invalid URL as-is', () => {
  const invalidUrl = 'not a valid url at all:::';
  const result = sanitizeUrlForDebugLogs(invalidUrl);
  assert.equal(result, invalidUrl);
});

void test('sanitizeUrlForDebugLogs returns unchanged URL when no sensitive keys present', () => {
  const url = 'https://api.example.com/search?q=game&format=brief';
  const result = sanitizeUrlForDebugLogs(url);
  assert.match(result, /q=game/);
  assert.match(result, /format=brief/);
});

void test('sanitizeHeadersForDebugLogs returns empty object for undefined input', () => {
  const result = sanitizeHeadersForDebugLogs(undefined);
  assert.deepEqual(result, {});
});

void test('sanitizeHeadersForDebugLogs redacts sensitive headers', () => {
  const headers = new Headers({
    authorization: 'Bearer secret-token',
    'x-api-key': 'my-api-key',
    'api-key': 'another-key',
    'content-type': 'application/json'
  });
  const result = sanitizeHeadersForDebugLogs(headers);
  assert.equal(result['authorization'], '***');
  assert.equal(result['x-api-key'], '***');
  assert.equal(result['api-key'], '***');
  assert.equal(result['content-type'], 'application/json');
});

void test('sanitizeHeadersForDebugLogs handles plain object headers', () => {
  const headers = { 'content-type': 'text/plain', 'x-custom': 'value' };
  const result = sanitizeHeadersForDebugLogs(headers);
  assert.equal(result['content-type'], 'text/plain');
  assert.equal(result['x-custom'], 'value');
});

void test('logUpstreamRequest does nothing when debug logs are disabled', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: 'false' }, () => {
    const { request, logInfoCalls } = makeMockRequest();
    logUpstreamRequest(request, { url: 'https://example.com', method: 'GET' });
    assert.equal(logInfoCalls.length, 0);
    return Promise.resolve();
  });
});

void test('logUpstreamRequest logs request details when debug logs are enabled', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: '1' }, () => {
    const { request, logInfoCalls } = makeMockRequest();
    logUpstreamRequest(request, {
      url: 'https://example.com?api_key=secret',
      method: 'GET',
      headers: { authorization: 'Bearer token' }
    });
    assert.equal(logInfoCalls.length, 1);
    const entry = logInfoCalls[0] as Record<string, unknown>;
    assert.equal(entry['msg'], 'upstream_http_request');
    assert.doesNotMatch(String(entry['url']), /secret/);
    return Promise.resolve();
  });
});

void test('logUpstreamRequest logs without headers when headers are omitted', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: '1' }, () => {
    const { request, logInfoCalls } = makeMockRequest();
    logUpstreamRequest(request, { url: 'https://example.com', method: 'POST' });
    assert.equal(logInfoCalls.length, 1);
    return Promise.resolve();
  });
});

void test('logUpstreamResponse does nothing when debug logs are disabled', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: 'false' }, async () => {
    const { request, logInfoCalls } = makeMockRequest();
    const response = new Response('hello', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
    await logUpstreamResponse(request, { url: 'https://example.com', method: 'GET', response });
    assert.equal(logInfoCalls.length, 0);
  });
});

void test('logUpstreamResponse logs with body preview for JSON responses', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: '1' }, async () => {
    const { request, logInfoCalls } = makeMockRequest();
    const body = JSON.stringify({ games: [{ id: 1 }] });
    const response = new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    await logUpstreamResponse(request, { url: 'https://example.com', method: 'GET', response });
    assert.equal(logInfoCalls.length, 1);
    const entry = logInfoCalls[0] as Record<string, unknown>;
    assert.equal(entry['msg'], 'upstream_http_response');
    assert.equal(entry['bodyPreview'], body);
  });
});

void test('logUpstreamResponse logs with body preview for text responses', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: '1' }, async () => {
    const { request, logInfoCalls } = makeMockRequest();
    const response = new Response('hello world', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
    await logUpstreamResponse(request, { url: 'https://example.com', method: 'GET', response });
    assert.equal(logInfoCalls.length, 1);
    const entry = logInfoCalls[0] as Record<string, unknown>;
    assert.equal(entry['bodyPreview'], 'hello world');
  });
});

void test('logUpstreamResponse has null bodyPreview for binary content types', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: '1' }, async () => {
    const { request, logInfoCalls } = makeMockRequest();
    const response = new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
      status: 200,
      headers: { 'content-type': 'image/png' }
    });
    await logUpstreamResponse(request, { url: 'https://example.com', method: 'GET', response });
    assert.equal(logInfoCalls.length, 1);
    const entry = logInfoCalls[0] as Record<string, unknown>;
    assert.equal(entry['bodyPreview'], null);
  });
});

void test('logUpstreamResponse has null bodyPreview for empty body', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: '1' }, async () => {
    const { request, logInfoCalls } = makeMockRequest();
    const response = new Response('', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    await logUpstreamResponse(request, { url: 'https://example.com', method: 'GET', response });
    assert.equal(logInfoCalls.length, 1);
    const entry = logInfoCalls[0] as Record<string, unknown>;
    assert.equal(entry['bodyPreview'], null);
  });
});

void test('logUpstreamResponse truncates very long body previews', async () => {
  await withEnv({ DEBUG_HTTP_LOGS: '1' }, async () => {
    const { request, logInfoCalls } = makeMockRequest();
    const longBody = 'x'.repeat(5000);
    const response = new Response(longBody, {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
    await logUpstreamResponse(request, { url: 'https://example.com', method: 'GET', response });
    const entry = logInfoCalls[0] as Record<string, unknown>;
    assert.match(String(entry['bodyPreview']), /\.\.\.\[truncated\]$/);
  });
});
