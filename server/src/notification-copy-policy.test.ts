import assert from 'node:assert/strict';
import test from 'node:test';
import { clampTitleWithSuffix, MAX_NOTIFICATION_TITLE } from './notification-copy-policy.js';

void test('clampTitleWithSuffix omits separator when base title is empty or whitespace', () => {
  assert.equal(
    clampTitleWithSuffix({ baseTitle: '', suffix: 'on sale', max: MAX_NOTIFICATION_TITLE }),
    'on sale'
  );
  assert.equal(
    clampTitleWithSuffix({ baseTitle: '   ', suffix: 'on sale', max: MAX_NOTIFICATION_TITLE }),
    'on sale'
  );
  assert.equal(
    clampTitleWithSuffix({ baseTitle: '\t\n', suffix: 'on sale', max: MAX_NOTIFICATION_TITLE }),
    'on sale'
  );
});

void test('clampTitleWithSuffix clamps suffix-only output within max length', () => {
  const suffix = 'a'.repeat(MAX_NOTIFICATION_TITLE + 10);
  const result = clampTitleWithSuffix({ baseTitle: '   ', suffix, max: MAX_NOTIFICATION_TITLE });
  assert.equal(result.length, MAX_NOTIFICATION_TITLE);
  assert.ok(result.endsWith('...'));
  assert.ok(!result.startsWith(' '));
});
