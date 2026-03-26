import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSingleLineLogMessage } from './single-line-console.js';

void test('formatSingleLineLogMessage escapes embedded newlines', () => {
  const formatted = formatSingleLineLogMessage(['[service] event', 'line1\nline2']);
  assert.equal(formatted, '[service] event line1\\nline2');
  assert.doesNotMatch(formatted, /\n/);
});

void test('formatSingleLineLogMessage serializes objects and errors onto one line', () => {
  const error = new Error('boom');
  error.stack = 'Error: boom\n    at test';

  const formatted = formatSingleLineLogMessage([
    '[service] failed',
    { nested: { ok: true }, message: 'hello\nworld' },
    error,
  ]);

  assert.match(formatted, /"nested":\{"ok":true\}/);
  assert.match(formatted, /"message":"hello\\nworld"/);
  assert.match(formatted, /"stack":"Error: boom\\n    at test"/);
  assert.doesNotMatch(formatted, /\n/);
});
