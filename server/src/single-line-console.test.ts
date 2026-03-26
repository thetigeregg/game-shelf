import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSingleLineLogMessage, installSingleLineConsole } from './single-line-console.js';

function parseLog(level: string, args: unknown[]): Record<string, unknown> {
  const formatted = formatSingleLineLogMessage(level, args);
  assert.doesNotMatch(formatted, /\n/);
  return JSON.parse(formatted) as Record<string, unknown>;
}

void test('formatSingleLineLogMessage emits structured JSON for event-prefixed logs', () => {
  const payload = parseLog('info', ['[service] event', 'line1\nline2']);
  assert.equal(payload['level'], 'info');
  assert.equal(payload['service'], 'service');
  assert.equal(payload['event'], 'event');
  assert.deepEqual(payload['args'], ['line1\\nline2']);
  assert.equal(typeof payload['ts'], 'string');
});

void test('formatSingleLineLogMessage serializes objects and errors onto one line', () => {
  const error = new Error('boom');
  error.stack = 'Error: boom\n    at test';

  const payload = parseLog('error', [
    '[service] failed',
    { nested: { ok: true }, message: 'hello\nworld' },
    error,
  ]);
  assert.equal(payload['message'], 'hello\\nworld');
  assert.deepEqual(payload['nested'], { ok: true });
  const args = payload['args'] as Array<Record<string, unknown>>;
  assert.equal(args.length, 1);
  assert.equal(args[0]?.['message'], 'boom');
  assert.equal(args[0]?.['stack'], 'Error: boom\\n    at test');
});

void test('formatSingleLineLogMessage handles circular references and nullish values', () => {
  const circular: Record<string, unknown> = { keep: 'value', empty: null, missing: undefined };
  circular['self'] = circular;

  const payload = parseLog('warn', ['[service] circular', circular]);
  assert.equal(payload['keep'], 'value');
  assert.equal(payload['empty'], null);
  assert.equal(payload['missing'], null);
  assert.equal(payload['self'], '[Circular]');
});

void test('formatSingleLineLogMessage renders circular error causes safely', () => {
  const error = new Error('boom') as Error & { cause?: unknown };
  error.cause = error;

  const payload = parseLog('error', ['[service] failed', error]);
  assert.equal(payload['message'], 'boom');
  assert.equal(payload['cause'], '[Circular]');
});

void test('formatSingleLineLogMessage only marks true cycles and keeps own prototype-named keys', () => {
  const repeated = { value: 'shared' };
  const payload = parseLog('info', [
    '[service] repeated_refs',
    {
      first: repeated,
      second: repeated,
      constructor: 'allowed',
      toString: 'also-allowed',
    },
  ]);

  assert.deepEqual(payload['first'], { value: 'shared' });
  assert.deepEqual(payload['second'], { value: 'shared' });
  assert.equal(payload['constructor'], 'allowed');
  assert.equal(payload['toString'], 'also-allowed');
  assert.equal(payload['args'], undefined);
});

void test('formatSingleLineLogMessage preserves __proto__ as data without polluting payloads', () => {
  const payload = parseLog('info', [
    '[service] proto_key',
    {
      ['__proto__']: { safe: true },
      nested: { ['__proto__']: 'still-data' },
    },
  ]);

  assert.equal(Object.getPrototypeOf(payload), Object.prototype);
  assert.deepEqual(payload['__proto__'], { safe: true });
  assert.deepEqual(payload['nested'], { ['__proto__']: 'still-data' });
  assert.equal((payload as Record<string, unknown> & { safe?: unknown }).safe, undefined);
});

void test('formatSingleLineLogMessage preserves non-finite numbers as strings', () => {
  const payload = parseLog('warn', ['[service] numeric_edge_cases', { nan: Number.NaN }, Infinity]);

  assert.equal(payload['nan'], 'NaN');
  assert.deepEqual(payload['args'], ['Infinity']);
});

void test('formatSingleLineLogMessage truncates long strings and large arrays', () => {
  const payload = parseLog('debug', [
    '[service] payload',
    {
      huge: 'x'.repeat(2_500),
      items: Array.from({ length: 25 }, (_, index) => index),
    },
  ]);

  assert.match(String(payload['huge']), /\.\.\.\[truncated\]$/);
  assert.equal(String(payload['huge']).length, 2_000);
  const items = payload['items'] as unknown[];
  assert.equal(items.length, 21);
  assert.equal(items[20], '[+5 more]');
});

void test('formatSingleLineLogMessage preserves string representations for non-plain objects', () => {
  const when = new Date('2026-03-26T12:34:56.000Z');
  const url = new URL('https://example.com/path?q=1');
  const map = new Map([['key', 'value']]);
  const set = new Set(['alpha', 'beta']);
  const payload = parseLog('info', ['[service] objects', { when, url, map, set }]);

  assert.equal(payload['when'], when.toString());
  assert.equal(payload['url'], url.toString());
  assert.equal(payload['map'], Object.prototype.toString.call(map));
  assert.equal(payload['set'], Object.prototype.toString.call(set));
});

void test('formatSingleLineLogMessage falls back safely when non-plain-object stringification throws', () => {
  const throwingTag = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === Symbol.toStringTag) {
          throw new Error('no tag for you');
        }

        return undefined;
      },
    }
  );
  const payload = parseLog('warn', ['[service] hostile_object', { throwingTag }]);

  assert.equal(payload['throwingTag'], '[object toString threw]');
});

void test('formatSingleLineLogMessage survives proxy getPrototypeOf traps', () => {
  const hostileProxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('prototype access denied');
      },
      get(_target, property) {
        if (property === Symbol.toStringTag) {
          return 'ProxyLike';
        }

        return undefined;
      },
    }
  );

  const payload = parseLog('warn', ['[service] hostile_proxy', { hostileProxy }]);

  assert.equal(payload['hostileProxy'], '[object ProxyLike]');
});

void test('formatSingleLineLogMessage truncates large objects without dropping retained keys', () => {
  const objectWithManyKeys = Object.fromEntries(
    Array.from({ length: 55 }, (_, index) => [`key${String(index)}`, index])
  );

  const payload = parseLog('info', ['[service] large_object', objectWithManyKeys]);

  for (let index = 0; index < 50; index += 1) {
    assert.equal(payload[`key${String(index)}`], index);
  }

  assert.equal(payload['key50'], undefined);
  assert.equal(payload['__truncatedKeys'], 5);
});

void test('formatSingleLineLogMessage falls back to app/log for empty args', () => {
  const payload = parseLog('info', []);
  assert.equal(payload['service'], 'app');
  assert.equal(payload['event'], 'log');
  assert.equal(payload['level'], 'info');
});

void test('installSingleLineConsole is idempotent and preserves conflicting fields in args', () => {
  const calls: string[] = [];
  const stubConsole = {
    info: (...args: unknown[]) => {
      calls.push(String(args[0]));
    },
  } as unknown as Console;

  const installed = installSingleLineConsole(stubConsole);
  assert.equal(installed, stubConsole);
  assert.equal(installSingleLineConsole(stubConsole), stubConsole);

  stubConsole.info('[api] started', { service: 'shadow', event: 'nested' }, 'ok');

  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0] ?? '{}') as Record<string, unknown>;
  assert.equal(payload['service'], 'api');
  assert.equal(payload['event'], 'started');
  assert.deepEqual(payload['args'], [{ event: 'nested' }, { service: 'shadow' }, 'ok']);
});

void test('installSingleLineConsole routes trace, dir, and table through single-line safe methods', () => {
  const logCalls: string[] = [];
  const errorCalls: string[] = [];
  const stubConsole = {
    log: (...args: unknown[]) => {
      logCalls.push(String(args[0]));
    },
    error: (...args: unknown[]) => {
      errorCalls.push(String(args[0]));
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
  } as unknown as Console;

  installSingleLineConsole(stubConsole);

  stubConsole.trace('[api] trace_event', { step: 'before' });
  stubConsole.dir({ okay: true });
  stubConsole.table([{ id: 1 }]);

  assert.equal(errorCalls.length, 1);
  const tracePayload = JSON.parse(errorCalls[0] ?? '{}') as Record<string, unknown>;
  assert.equal(tracePayload['level'], 'trace');
  assert.equal(tracePayload['service'], 'api');
  assert.equal(tracePayload['event'], 'trace_event');
  assert.equal(tracePayload['step'], 'before');
  const traceArgs = tracePayload['args'] as Array<Record<string, unknown>>;
  const traceStack = traceArgs[0]?.['stack'];
  assert.equal(typeof traceStack, 'string');
  assert.match(traceStack, /Error/);

  assert.equal(logCalls.length, 2);
  const dirPayload = JSON.parse(logCalls[0] ?? '{}') as Record<string, unknown>;
  assert.equal(dirPayload['level'], 'dir');
  assert.equal(dirPayload['okay'], true);

  const tablePayload = JSON.parse(logCalls[1] ?? '{}') as Record<string, unknown>;
  assert.equal(tablePayload['level'], 'table');
  assert.deepEqual(tablePayload['args'], [[{ id: 1 }]]);
});
