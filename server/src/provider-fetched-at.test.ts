import assert from 'node:assert/strict';
import test from 'node:test';
import { forwardUpstreamHeaders, readFetchedAt, withFetchedAt } from './provider-fetched-at.js';

void test('withFetchedAt adds an ISO fetchedAt to object payloads', () => {
  assert.deepEqual(withFetchedAt({ item: null }, '2026-11-01T10:00:00Z'), {
    item: null,
    fetchedAt: '2026-11-01T10:00:00.000Z',
  });
  assert.deepEqual(withFetchedAt({ games: [] }, Date.parse('2026-11-01T10:00:00.000Z')), {
    games: [],
    fetchedAt: '2026-11-01T10:00:00.000Z',
  });
  assert.deepEqual(withFetchedAt({}, new Date('2026-11-01T10:00:00.000Z')), {
    fetchedAt: '2026-11-01T10:00:00.000Z',
  });
});

void test('withFetchedAt leaves non-object payloads and invalid dates alone', () => {
  assert.equal(withFetchedAt(null, '2026-11-01T10:00:00Z'), null);
  assert.equal(withFetchedAt('text', '2026-11-01T10:00:00Z'), 'text');
  assert.deepEqual(withFetchedAt([1], '2026-11-01T10:00:00Z'), [1]);
  assert.deepEqual(withFetchedAt({ item: null }, 'not a date'), { item: null });
});

void test('readFetchedAt returns a valid fetchedAt as ISO, else null', () => {
  assert.equal(readFetchedAt({ fetchedAt: '2026-11-01T10:00:00Z' }), '2026-11-01T10:00:00.000Z');
  assert.equal(readFetchedAt({ fetchedAt: 'not a date' }), null);
  assert.equal(readFetchedAt({ fetchedAt: '  ' }), null);
  assert.equal(readFetchedAt({ fetchedAt: 42 }), null);
  assert.equal(readFetchedAt({}), null);
  assert.equal(readFetchedAt(null), null);
  assert.equal(readFetchedAt([]), null);
});

void test('forwardUpstreamHeaders copies headers except body-bound ones', () => {
  const set: Record<string, string> = {};
  const reply = {
    header: (key: string, value: string) => {
      set[key] = value;
      return reply;
    },
  };
  forwardUpstreamHeaders(
    reply as unknown as Parameters<typeof forwardUpstreamHeaders>[0],
    new Response('{}', {
      headers: {
        'cache-control': 'max-age=60',
        'content-encoding': 'gzip',
        'transfer-encoding': 'chunked',
      },
    })
  );

  assert.equal(set['cache-control'], 'max-age=60');
  assert.equal(set['content-encoding'], undefined);
  assert.equal(set['transfer-encoding'], undefined);
});
