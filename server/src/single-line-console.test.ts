import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSingleLineLogMessage } from './single-line-console.js';

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

void test('formatSingleLineLogMessage truncates long strings and large arrays', () => {
  const payload = parseLog('debug', [
    '[service] payload',
    {
      huge: 'x'.repeat(2_500),
      items: Array.from({ length: 25 }, (_, index) => index),
    },
  ]);

  assert.match(String(payload['huge']), /\.\.\.\[truncated\]$/);
  const items = payload['items'] as unknown[];
  assert.equal(items.length, 21);
  assert.equal(items[20], '[+5 more]');
});
