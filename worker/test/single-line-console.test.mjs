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
  assert.equal(String(payload.huge).length, 2000);
  assert.equal(payload.items.length, 21);
  assert.equal(payload.items[20], '[+5 more]');
  assert.equal(payload.manyKeys.__truncatedKeys, 5);

  const fallback = parseLog('info', null);
  assert.equal(fallback.service, 'app');
  assert.equal(fallback.event, 'log');
});

test('shared single-line console renders circular error causes safely', () => {
  const error = new Error('boom');
  error.cause = error;

  const payload = parseLog('error', ['[worker] failed', error]);

  assert.equal(payload.message, 'boom');
  assert.equal(payload.cause, '[Circular]');
});

test('shared single-line console only marks true cycles and keeps own prototype-named keys', () => {
  const repeated = { value: 'shared' };
  const payload = parseLog('info', [
    '[worker] repeated_refs',
    {
      first: repeated,
      second: repeated,
      constructor: 'allowed',
      toString: 'also-allowed',
    },
  ]);

  assert.deepEqual(payload.first, { value: 'shared' });
  assert.deepEqual(payload.second, { value: 'shared' });
  assert.equal(payload.constructor, 'allowed');
  assert.equal(payload.toString, 'also-allowed');
  assert.equal(payload.args, undefined);
});

test('shared single-line console preserves __proto__ as data without polluting payloads', () => {
  const payload = parseLog('info', [
    '[worker] proto_key',
    {
      ['__proto__']: { safe: true },
      nested: { ['__proto__']: 'still-data' },
    },
  ]);

  assert.equal(Object.getPrototypeOf(payload), Object.prototype);
  assert.deepEqual(payload.__proto__, { safe: true });
  assert.deepEqual(payload.nested, { ['__proto__']: 'still-data' });
  assert.equal(payload.safe, undefined);
});

test('shared single-line console preserves non-finite numbers as strings', () => {
  const payload = parseLog('warn', ['[worker] numeric_edge_cases', { nan: Number.NaN }, Infinity]);

  assert.equal(payload.nan, 'NaN');
  assert.deepEqual(payload.args, ['Infinity']);
});

test('shared single-line console preserves string representations for non-plain objects', () => {
  const when = new Date('2026-03-26T12:34:56.000Z');
  const url = new URL('https://example.com/path?q=1');
  const map = new Map([['key', 'value']]);
  const set = new Set(['alpha', 'beta']);
  const payload = parseLog('info', ['[worker] objects', { when, url, map, set }]);

  assert.equal(payload.when, String(when));
  assert.equal(payload.url, String(url));
  assert.equal(payload.map, String(map));
  assert.equal(payload.set, String(set));
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

test('shared single-line console routes trace, dir, and table without native multiline renderers', () => {
  const logCalls = [];
  const errorCalls = [];
  const stubConsole = {
    log: (...args) => {
      logCalls.push(args);
    },
    error: (...args) => {
      errorCalls.push(args);
    },
    trace: () => {
      throw new Error('native trace should not be called');
    },
    dir: () => {
      throw new Error('native dir should not be called');
    },
    table: () => {
      throw new Error('native table should not be called');
    },
  };

  installSingleLineConsole(stubConsole);

  stubConsole.trace('[worker] trace_event', { stage: 'fetch' });
  stubConsole.dir({ okay: true });
  stubConsole.table([{ id: 1 }]);

  assert.equal(errorCalls.length, 1);
  const tracePayload = JSON.parse(String(errorCalls[0][0]));
  assert.equal(tracePayload.level, 'trace');
  assert.equal(tracePayload.service, 'worker');
  assert.equal(tracePayload.event, 'trace_event');
  assert.equal(tracePayload.stage, 'fetch');
  assert.match(String(tracePayload.args[0].stack), /Error/);

  assert.equal(logCalls.length, 2);
  const dirPayload = JSON.parse(String(logCalls[0][0]));
  assert.equal(dirPayload.level, 'dir');
  assert.equal(dirPayload.okay, true);

  const tablePayload = JSON.parse(String(logCalls[1][0]));
  assert.equal(tablePayload.level, 'table');
  assert.deepEqual(tablePayload.args, [[{ id: 1 }]]);
});
