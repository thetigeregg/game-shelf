import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAiEmbeddingClient } from './embedding-client.js';

const ORIGINAL_FETCH = globalThis.fetch;

function restoreFetch(): void {
  globalThis.fetch = ORIGINAL_FETCH;
}

void test('generateEmbeddings returns empty array for empty input', async () => {
  const client = new OpenAiEmbeddingClient({
    apiKey: 'key',
    model: 'text-embedding-3-small',
    dimensions: 3,
  });
  const result = await client.generateEmbeddings([]);
  assert.deepEqual(result, []);
});

void test('generateEmbeddings throws when api key is missing', async () => {
  const client = new OpenAiEmbeddingClient({
    apiKey: ' ',
    model: 'text-embedding-3-small',
    dimensions: 3,
  });
  await assert.rejects(() => client.generateEmbeddings(['hello']), /OPENAI_API_KEY is required/);
});

void test('generateEmbeddings throws for non-ok response and shortens body text', async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response('x'.repeat(1000), {
        status: 429,
        statusText: 'Too Many Requests',
      })
    )) as typeof fetch;

  const client = new OpenAiEmbeddingClient({
    apiKey: 'key',
    model: 'text-embedding-3-small',
    dimensions: 3,
  });
  await assert.rejects(
    () => client.generateEmbeddings(['hello']),
    /OpenAI embeddings request failed \(429\)/
  );
  restoreFetch();
});

void test('generateEmbeddings validates response entry count and embedding presence', async () => {
  const client = new OpenAiEmbeddingClient({
    apiKey: 'key',
    model: 'text-embedding-3-small',
    dimensions: 3,
  });

  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0, 0, 0] }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )) as typeof fetch;
  await assert.rejects(() => client.generateEmbeddings(['a', 'b']), /expected number of vectors/);

  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [{ index: 1, embedding: [0, 1, 0] }, { index: 0 }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )) as typeof fetch;
  await assert.rejects(() => client.generateEmbeddings(['a', 'b']), /missing embedding data/);

  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            { index: 0, embedding: [1, 0] },
            { index: 1, embedding: [0, 1, 0] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )) as typeof fetch;
  await assert.rejects(() => client.generateEmbeddings(['a', 'b']), /incorrect dimension/);

  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            { index: 0, embedding: [1, Number.NaN, 0] },
            { index: 1, embedding: [0, 1, 0] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )) as typeof fetch;
  await assert.rejects(() => client.generateEmbeddings(['a', 'b']), /non-finite embedding values/);
  restoreFetch();
});

void test('generateEmbeddings returns vectors sorted by index', async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1, 0] },
            { index: 0, embedding: [1, 0, 0] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )) as typeof fetch;

  const client = new OpenAiEmbeddingClient({
    apiKey: 'key',
    model: 'text-embedding-3-small',
    dimensions: 3,
  });
  const vectors = await client.generateEmbeddings(['a', 'b']);
  assert.deepEqual(vectors, [
    [1, 0, 0],
    [0, 1, 0],
  ]);
  restoreFetch();
});

void test('generateEmbeddings aborts on request timeout', async () => {
  globalThis.fetch = ((_: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error('missing abort signal'));
        return;
      }

      signal.addEventListener('abort', () => {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        reject(abortError);
      });
    });
  }) as typeof fetch;

  const client = new OpenAiEmbeddingClient({
    apiKey: 'key',
    model: 'text-embedding-3-small',
    dimensions: 3,
    timeoutMs: 5,
  });

  await assert.rejects(
    () => client.generateEmbeddings(['a']),
    /OpenAI embeddings request timed out after 5ms/
  );
  restoreFetch();
});
