import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSingleLineLogMessage,
  installSingleLineConsole,
} from '../../shared/single-line-console.mjs';

function parseLog(level, args) {
  const formatted = formatSingleLineLogMessage(level, args);
  assert.doesNotMatch(formatted, /\n/);
  return JSON.parse(formatted);
}

test('shared single-line console normalizes primitives and deep structures', () => {
  const payload = parseLog('warn', [
    'plain message',
    {
      count: 3n,
      symbol: Symbol('token'),
      fn: function namedHelper() {},
      nested: { value: { more: { items: { deep: { leaf: true } } } } },
    },
  ]);

  assert.equal(payload.level, 'warn');
  assert.equal(payload.service, 'app');
  assert.equal(payload.message, 'plain message');
  assert.equal(payload.count, '3');
  assert.equal(payload.symbol, 'Symbol(token)');
  assert.match(String(payload.fn), /namedHelper/);
  assert.equal(payload.nested.value.more.items.deep, '[Object]');
});

test('shared single-line console handles truncation, circular values, and fallback events', () => {
  const circular = { keep: 'value' };
  circular.self = circular;

  const payload = parseLog('debug', [
    '[worker] event',
    {
      circular,
      huge: 'x'.repeat(2_500),
      items: Array.from({ length: 25 }, (_, index) => index),
      manyKeys: Object.fromEntries(Array.from({ length: 55 }, (_, index) => [`k${index}`, index])),
    },
  ]);

  assert.equal(payload.service, 'worker');
  assert.equal(payload.event, 'event');
  assert.equal(payload.circular.self, '[Circular]');
  assert.match(String(payload.huge), /\.\.\.\[truncated\]$/);
  assert.equal(payload.items.length, 21);
  assert.equal(payload.items[20], '[+5 more]');
  assert.equal(payload.manyKeys.__truncatedKeys, 5);

  const fallback = parseLog('info', null);
  assert.equal(fallback.service, 'app');
  assert.equal(fallback.event, 'log');
});

test('shared single-line console installation wraps supported methods once', () => {
  const calls = [];
  const stubConsole = {
    log: (...args) => {
      calls.push(args);
    },
    warn: (...args) => {
      calls.push(args);
    },
    table: 'not-a-function',
  };

  assert.equal(installSingleLineConsole(stubConsole), stubConsole);
  assert.equal(installSingleLineConsole(stubConsole), stubConsole);

  stubConsole.log('[scraper] started', { event: 'shadowed' }, ['line1\nline2']);
  stubConsole.warn({ okay: true });

  assert.equal(calls.length, 2);

  const first = JSON.parse(String(calls[0][0]));
  assert.equal(calls[0].length, 1);
  assert.equal(first.service, 'scraper');
  assert.equal(first.event, 'started');
  assert.deepEqual(first.args, [{ event: 'shadowed' }, ['line1\\nline2']]);

  const second = JSON.parse(String(calls[1][0]));
  assert.equal(second.service, 'app');
  assert.equal(second.event, 'log');
  assert.equal(second.okay, true);
});
