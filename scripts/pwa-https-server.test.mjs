import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassThrough, Writable } from 'node:stream';

import {
  createHandler,
  getDisplayHost,
  isEntrypoint,
  parseArgs,
  proxyRequest,
  resolveSafePath,
  sendFile,
} from './pwa-https-server.mjs';

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

test('resolveSafePath allows dot-prefixed files that stay inside the static root', () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'pwa-https-server-root-'));

  try {
    const result = resolveSafePath(rootDir, '/..well-known/assetlinks.json');

    assert.deepEqual(result, {
      kind: 'ok',
      path: path.resolve(rootDir, '..well-known/assetlinks.json'),
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('resolveSafePath returns bad-request for malformed encoded paths', () => {
  const result = resolveSafePath('/tmp/game-shelf-root', '/bad%E0%A4%A');

  assert.deepEqual(result, { kind: 'bad-request' });
});

test('resolveSafePath rejects symlink escapes that leave the static root', () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'pwa-https-server-root-'));
  const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'pwa-https-server-outside-'));

  try {
    writeFileSync(path.join(outsideDir, 'secret.txt'), 'top secret');
    symlinkSync(outsideDir, path.join(rootDir, 'assets'));

    const result = resolveSafePath(rootDir, '/assets/secret.txt');

    assert.deepEqual(result, { kind: 'forbidden' });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('parseArgs rejects invalid proxy origins before the server starts', () => {
  assert.throws(
    () =>
      parseArgs([
        '--port',
        '9443',
        '--cert',
        'cert.pem',
        '--key',
        'key.pem',
        '--root',
        'dist/app',
        '--proxy-origin',
        'proxy.example',
      ]),
    /valid absolute http\(s\) URL/
  );

  assert.throws(
    () =>
      parseArgs([
        '--port',
        '9443',
        '--cert',
        'cert.pem',
        '--key',
        'key.pem',
        '--root',
        'dist/app',
        '--proxy-origin',
        'ftp://proxy.example',
      ]),
    /must use the http or https scheme/
  );
});

test('parseArgs defaults to localhost and rejects invalid tcp ports', () => {
  assert.deepEqual(
    parseArgs([
      '--port',
      '9443',
      '--cert',
      'cert.pem',
      '--key',
      'key.pem',
      '--root',
      'dist/app',
      '--proxy-origin',
      'https://proxy.example',
    ]),
    {
      host: '127.0.0.1',
      port: 9443,
      cert: 'cert.pem',
      key: 'key.pem',
      root: 'dist/app',
      proxyOrigin: 'https://proxy.example',
    }
  );

  for (const invalidPort of ['0', '-1', '65536', 'NaN']) {
    assert.throws(
      () =>
        parseArgs([
          '--port',
          invalidPort,
          '--cert',
          'cert.pem',
          '--key',
          'key.pem',
          '--root',
          'dist/app',
          '--proxy-origin',
          'https://proxy.example',
        ]),
      /Port must be an integer between 1 and 65535/
    );
  }
});

test('getDisplayHost prefers the configured host except for wildcard bindings', () => {
  assert.equal(getDisplayHost('127.0.0.1'), '127.0.0.1');
  assert.equal(getDisplayHost('devbox.local'), 'devbox.local');
  assert.equal(getDisplayHost('0.0.0.0'), 'localhost');
  assert.equal(getDisplayHost(undefined), 'localhost');
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

test('createHandler returns 404 for missing asset paths instead of the SPA shell', async () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'pwa-https-server-'));
  writeFileSync(path.join(rootDir, 'index.html'), '<!doctype html><title>Game Shelf</title>');

  try {
    const handler = createHandler(rootDir, 'https://proxy.example');
    const response = new MockResponse();

    handler(
      {
        method: 'GET',
        url: '/assets/missing.png',
        headers: {
          accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
        },
      },
      response
    );

    await waitForStreamEnd(response);

    assert.equal(response.statusCode, 404);
    assert.match(response.body, /Not found/);
    assert.equal(response.headers?.['Content-Type'], 'text/plain; charset=utf-8');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('sendFile returns 404 when the file disappears before it can be read', async () => {
  const response = new MockResponse();

  sendFile('/tmp/definitely-missing-file.txt', response, 'GET');
  await waitForStreamEnd(response);

  assert.equal(response.statusCode, 404);
  assert.match(response.body, /Not found/);
});

test('sendFile returns 404 when the file disappears before the stream opens', async () => {
  const response = new MockResponse();
  const fileStream = new PassThrough();
  fileStream.destroy = () => fileStream;

  sendFile('/tmp/transient-file.txt', response, 'GET', {
    statSyncFn() {
      return { size: 42 };
    },
    createReadStreamFn() {
      process.nextTick(() => {
        const error = new Error('missing file');
        error.code = 'ENOENT';
        fileStream.emit('error', error);
      });
      return fileStream;
    },
  });

  await waitForStreamEnd(response);

  assert.equal(response.statusCode, 404);
  assert.match(response.body, /Not found/);
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

test('proxyRequest rejects scheme-relative request targets instead of proxying them', () => {
  let transportCalled = false;
  const request = new PassThrough();
  request.method = 'GET';
  request.url = '//evil.example/api/games';
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
  assert.match(response.body, /Scheme-relative URLs are not supported by this proxy/);
});

test('proxyRequest strips hop-by-hop headers before forwarding upstream', () => {
  const request = new PassThrough();
  request.method = 'GET';
  request.url = '/api/games?filter=recent';
  request.headers = {
    accept: 'application/json',
    connection: 'keep-alive',
    host: 'attacker.example',
    'keep-alive': 'timeout=5',
    'proxy-authorization': 'Basic abc123',
    te: 'trailers',
    trailer: 'x-debug',
    'transfer-encoding': 'chunked',
    upgrade: 'websocket',
    'x-forwarded-test': 'preserved',
  };
  const response = new MockResponse();
  let forwardedOptions;

  proxyRequest(request, response, 'https://proxy.example', {
    httpsTransport: {
      request(options) {
        forwardedOptions = options;
        return new PassThrough();
      },
    },
  });

  request.end();

  assert.deepEqual(forwardedOptions?.headers, {
    host: 'proxy.example',
    accept: 'application/json',
    'x-forwarded-test': 'preserved',
  });
});

test('proxyRequest destroys the response when the upstream fails after headers were sent', async () => {
  const request = new PassThrough();
  request.method = 'GET';
  request.url = '/api/games';
  request.headers = {};

  const proxyStream = new PassThrough();
  let destroyedWithError;
  const response = {
    headersSent: true,
    destroy(error) {
      destroyedWithError = error;
    },
    writeHead() {
      throw new Error('writeHead should not be called after headers are sent');
    },
    end() {
      throw new Error('end should not be called after headers are sent');
    },
  };

  proxyRequest(request, response, 'https://proxy.example', {
    httpsTransport: {
      request() {
        return proxyStream;
      },
    },
  });

  const upstreamError = new Error('socket hang up');
  proxyStream.emit('error', upstreamError);
  request.end();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(destroyedWithError, upstreamError);
});

test('proxyRequest destroys the response when the upstream response errors after headers are sent', async () => {
  const request = new PassThrough();
  request.method = 'GET';
  request.url = '/api/games';
  request.headers = {};

  const proxyResponse = new PassThrough();
  proxyResponse.statusCode = 200;
  proxyResponse.headers = { 'content-type': 'application/json' };

  let destroyedWithError;
  const response = {
    writableEnded: false,
    destroy(error) {
      destroyedWithError = error;
      this.writableEnded = true;
    },
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
      return this;
    },
    on() {
      return this;
    },
    once() {
      return this;
    },
    emit() {
      return false;
    },
    write() {
      return true;
    },
    end() {
      this.writableEnded = true;
    },
  };

  proxyRequest(request, response, 'https://proxy.example', {
    httpsTransport: {
      request(_options, callback) {
        setImmediate(() => callback(proxyResponse));
        return new PassThrough();
      },
    },
  });

  request.end();
  await new Promise((resolve) => setImmediate(resolve));

  const upstreamError = new Error('upstream response failed');
  proxyResponse.emit('error', upstreamError);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.headers, { 'content-type': 'application/json' });
  assert.equal(destroyedWithError, upstreamError);
});

test('proxyRequest destroys the response when the upstream response aborts after headers are sent', async () => {
  const request = new PassThrough();
  request.method = 'GET';
  request.url = '/api/games';
  request.headers = {};

  const proxyResponse = new PassThrough();
  proxyResponse.statusCode = 200;
  proxyResponse.headers = { 'content-type': 'application/json' };

  let destroyCalls = 0;
  const response = {
    writableEnded: false,
    destroy() {
      destroyCalls += 1;
      this.writableEnded = true;
    },
    writeHead() {
      return this;
    },
    on() {
      return this;
    },
    once() {
      return this;
    },
    emit() {
      return false;
    },
    write() {
      return true;
    },
    end() {
      this.writableEnded = true;
    },
  };

  proxyRequest(request, response, 'https://proxy.example', {
    httpsTransport: {
      request(_options, callback) {
        setImmediate(() => callback(proxyResponse));
        return new PassThrough();
      },
    },
  });

  request.end();
  await new Promise((resolve) => setImmediate(resolve));

  proxyResponse.emit('aborted');

  assert.equal(destroyCalls, 1);
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
