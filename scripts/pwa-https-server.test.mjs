import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassThrough, Writable } from 'node:stream';

import { createHandler, isEntrypoint, proxyRequest, resolveSafePath } from './pwa-https-server.mjs';

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = undefined;
    this.headers = undefined;
    this.body = '';
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  }

  _write(chunk, encoding, callback) {
    this.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    callback();
  }
}

function waitForStreamEnd(stream) {
  return new Promise((resolve, reject) => {
    stream.once('finish', resolve);
    stream.once('error', reject);
  });
}

test('resolveSafePath rejects parent-directory traversal attempts', () => {
  const result = resolveSafePath('/tmp/game-shelf-root', '/../secrets.txt');

  assert.deepEqual(result, { kind: 'forbidden' });
});

test('resolveSafePath returns bad-request for malformed encoded paths', () => {
  const result = resolveSafePath('/tmp/game-shelf-root', '/bad%E0%A4%A');

  assert.deepEqual(result, { kind: 'bad-request' });
});

test('createHandler falls back to index.html for unknown SPA routes', async () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'pwa-https-server-'));
  writeFileSync(path.join(rootDir, 'index.html'), '<!doctype html><title>Game Shelf</title>');

  try {
    const handler = createHandler(rootDir, 'https://proxy.example');
    const response = new MockResponse();

    handler(
      {
        method: 'GET',
        url: '/library/playing-now',
      },
      response
    );

    await waitForStreamEnd(response);

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Game Shelf/);
    assert.equal(response.headers?.['Content-Type'], 'text/html; charset=utf-8');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('proxyRequest rejects absolute-form request targets instead of proxying them', () => {
  let transportCalled = false;
  const request = new PassThrough();
  request.method = 'GET';
  request.url = 'https://evil.example/api/games';
  request.headers = {};
  const response = new MockResponse();

  proxyRequest(request, response, 'https://proxy.example', {
    httpsTransport: {
      request() {
        transportCalled = true;
        throw new Error('transport should not be called');
      },
    },
  });

  assert.equal(transportCalled, false);
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /Only origin-form URLs are supported by this proxy/);
});

test('isEntrypoint resolves relative script paths before comparing module urls', () => {
  assert.equal(
    isEntrypoint({
      argv1: 'scripts/pwa-https-server.mjs',
      moduleUrl: new URL('./pwa-https-server.mjs', import.meta.url).href,
    }),
    true
  );
});
