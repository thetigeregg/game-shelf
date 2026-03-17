import assert from 'node:assert/strict';
import test from 'node:test';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  fetchMetadataFromWorker,
  fetchMetadataPathFromWorker,
  sendWebResponse
} from '../metadata.js';

class ReplyMock {
  statusCode = 200;
  headers: Record<string, string> = {};
  payload: unknown = undefined;

  code(value: number): this {
    this.statusCode = value;
    return this;
  }

  header(key: string, value: string): this {
    this.headers[key.toLowerCase()] = value;
    return this;
  }

  send(value?: unknown): this {
    this.payload = value;
    return this;
  }
}

void test('fetchMetadataPathFromWorker forwards query params and returns response', async () => {
  const response = await fetchMetadataPathFromWorker('/igdb/search', {
    query: 'fable',
    limit: 10,
    includeScreens: true,
    skip: null
  });

  assert.equal(response instanceof Response, true);
});

void test('fetchMetadataFromWorker creates proxy request from fastify request', async () => {
  const request = {
    url: '/igdb/search?query=halo',
    method: 'GET',
    headers: {}
  } as unknown as FastifyRequest;

  const response = await fetchMetadataFromWorker(request);
  assert.equal(response instanceof Response, true);
});

void test('sendWebResponse handles empty, text/json, and binary bodies', async () => {
  const emptyReply = new ReplyMock();
  await sendWebResponse(
    emptyReply as unknown as FastifyReply,
    new Response(null, {
      status: 204,
      headers: { 'content-type': 'application/json' }
    })
  );
  assert.equal(emptyReply.statusCode, 204);
  assert.equal(emptyReply.payload, undefined);

  const jsonReply = new ReplyMock();
  await sendWebResponse(
    jsonReply as unknown as FastifyReply,
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  );
  assert.equal(jsonReply.payload, JSON.stringify({ ok: true }));

  const textReply = new ReplyMock();
  await sendWebResponse(
    textReply as unknown as FastifyReply,
    new Response('hello', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    })
  );
  assert.equal(textReply.payload, 'hello');

  const binaryReply = new ReplyMock();
  await sendWebResponse(
    binaryReply as unknown as FastifyReply,
    new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' }
    })
  );
  assert.equal(Buffer.isBuffer(binaryReply.payload), true);
});
