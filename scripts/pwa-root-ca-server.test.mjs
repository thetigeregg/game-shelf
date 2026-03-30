import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';

import {
  createHandler,
  createServer,
  getDisplayHost,
  isEntrypoint,
  parseArgs,
} from './pwa-root-ca-server.mjs';

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

test('parseArgs normalizes the configured download route', () => {
  assert.deepEqual(
    parseArgs(['--port', '9000', '--file', '/tmp/rootCA.pem', '--route', 'rootCA.pem']),
    {
      host: '127.0.0.1',
      port: 9000,
      file: '/tmp/rootCA.pem',
      route: '/rootCA.pem',
    }
  );
});

test('parseArgs rejects invalid tcp ports', () => {
  for (const invalidPort of ['0', '-1', '65536', 'NaN', '9000xyz']) {
    assert.throws(
      () => parseArgs(['--port', invalidPort, '--file', '/tmp/rootCA.pem']),
      /Port must be an integer between 1 and 65535/
    );
  }
});

test('createServer rejects missing root CA files', () => {
  assert.throws(
    () =>
      createServer({
        host: '127.0.0.1',
        port: 9000,
        file: '/tmp/definitely-missing-rootCA.pem',
        route: '/rootCA.pem',
      }),
    /Root CA file not found/
  );
});

test('createHandler returns instructions at the root path', async () => {
  const response = new MockResponse();
  const handler = createHandler({
    host: '127.0.0.1',
    port: 9000,
    route: '/rootCA.pem',
    fileBuffer: Buffer.from('pem'),
    fileSize: 3,
  });

  handler({ url: '/', method: 'GET' }, response);
  await waitForStreamEnd(response);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /http:\/\/127\.0\.0\.1:9000\/rootCA\.pem/);
});

test('createHandler returns bad request for malformed request targets instead of throwing', async () => {
  const response = new MockResponse();
  const handler = createHandler({
    host: '127.0.0.1',
    port: 9000,
    route: '/rootCA.pem',
    fileBuffer: Buffer.from('pem'),
    fileSize: 3,
  });

  handler({ url: 'http://%zz', method: 'GET' }, response);
  await waitForStreamEnd(response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /Bad request/);
});

test('createHandler serves the pem file at the configured route', async () => {
  const response = new MockResponse();
  const handler = createHandler({
    host: '127.0.0.1',
    port: 9000,
    route: '/rootCA.pem',
    fileBuffer: Buffer.from('pem-data'),
    fileSize: 8,
  });

  handler({ url: '/rootCA.pem', method: 'GET' }, response);
  await waitForStreamEnd(response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['Content-Type'], 'application/x-pem-file');
  assert.equal(response.body, 'pem-data');
});

test('createHandler returns not found for unknown routes', async () => {
  const response = new MockResponse();
  const handler = createHandler({
    host: '127.0.0.1',
    port: 9000,
    route: '/rootCA.pem',
    fileBuffer: Buffer.from('pem-data'),
    fileSize: 8,
  });

  handler({ url: '/missing.pem', method: 'GET' }, response);
  await waitForStreamEnd(response);

  assert.equal(response.statusCode, 404);
  assert.match(response.body, /Not found/);
});

test('createHandler rejects non-GET and non-HEAD methods', async () => {
  const response = new MockResponse();
  const handler = createHandler({
    host: '127.0.0.1',
    port: 9000,
    route: '/rootCA.pem',
    fileBuffer: Buffer.from('pem-data'),
    fileSize: 8,
  });

  handler({ url: '/rootCA.pem', method: 'POST' }, response);
  await waitForStreamEnd(response);

  assert.equal(response.statusCode, 405);
  assert.match(response.body, /Method not allowed/);
});

test('createHandler omits the response body for HEAD requests', async () => {
  const response = new MockResponse();
  const handler = createHandler({
    host: 'devbox.local',
    port: 9000,
    route: '/rootCA.pem',
    fileBuffer: Buffer.from('pem-data'),
    fileSize: 8,
  });

  handler({ url: '/', method: 'HEAD' }, response);
  await waitForStreamEnd(response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, '');
});

test('getDisplayHost prefers the configured host except for wildcard bindings', () => {
  assert.equal(getDisplayHost('127.0.0.1'), '127.0.0.1');
  assert.equal(getDisplayHost('devbox.local'), 'devbox.local');
  assert.equal(getDisplayHost('0.0.0.0'), 'localhost');
  assert.equal(getDisplayHost(undefined), 'localhost');
});

test('isEntrypoint resolves relative script paths before comparing module urls', () => {
  assert.equal(
    isEntrypoint({
      argv1: 'scripts/pwa-root-ca-server.mjs',
      moduleUrl: new URL('./pwa-root-ca-server.mjs', import.meta.url).href,
    }),
    true
  );
});
