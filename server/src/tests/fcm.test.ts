import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../config.js';
import {
  hasConfiguredFcm,
  resetFcmStateForTests,
  sendFcmMulticast,
  summarizeFcmSendFailures,
} from '../fcm.js';
import type { BatchResponse } from 'firebase-admin/messaging';

void test('hasConfiguredFcm reflects service account config presence', () => {
  const original = config.firebaseServiceAccountJson;
  try {
    resetFcmStateForTests();
    config.firebaseServiceAccountJson = '';
    assert.equal(hasConfiguredFcm(), false);
    config.firebaseServiceAccountJson = '{"projectId":"p"}';
    assert.equal(hasConfiguredFcm(), true);
  } finally {
    resetFcmStateForTests();
    config.firebaseServiceAccountJson = original;
  }
});

void test('sendFcmMulticast handles empty and unconfigured token flows', async () => {
  const original = config.firebaseServiceAccountJson;
  try {
    resetFcmStateForTests();
    config.firebaseServiceAccountJson = '';

    const emptyResult = await sendFcmMulticast(['', '  '], {
      title: 't',
      body: 'b',
      data: { route: '/tabs/wishlist' },
    });
    assert.deepEqual(emptyResult, {
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
    });

    const noConfigResult = await sendFcmMulticast(['token-1', 'token-1', 'token-2'], {
      title: 't',
      body: 'b',
      data: { eventType: 'test' },
    });
    assert.deepEqual(noConfigResult, {
      successCount: 0,
      failureCount: 2,
      invalidTokens: [],
    });
  } finally {
    resetFcmStateForTests();
    config.firebaseServiceAccountJson = original;
  }
});

void test('sendFcmMulticast warns once when FCM is unconfigured', async () => {
  const original = config.firebaseServiceAccountJson;
  const originalWarn = console.warn;
  const warnings: Array<{ message: unknown; detail: unknown }> = [];
  console.warn = (message?: unknown, detail?: unknown): void => {
    warnings.push({ message, detail });
  };

  try {
    resetFcmStateForTests();
    config.firebaseServiceAccountJson = '';

    const first = await sendFcmMulticast(['token-1', 'token-2'], {
      title: 't',
      body: 'b',
      data: { eventType: 'test' },
    });
    const second = await sendFcmMulticast(['token-3'], {
      title: 't',
      body: 'b',
      data: { eventType: 'test' },
    });

    // Return contract is unchanged by the added logging.
    assert.deepEqual(first, { successCount: 0, failureCount: 2, invalidTokens: [] });
    assert.deepEqual(second, { successCount: 0, failureCount: 1, invalidTokens: [] });

    const notConfiguredWarnings = warnings.filter(
      (entry) => entry.message === '[fcm] not_configured'
    );
    assert.equal(notConfiguredWarnings.length, 1);
    assert.deepEqual(notConfiguredWarnings[0]?.detail, { skippedTokenCount: 2 });
  } finally {
    console.warn = originalWarn;
    resetFcmStateForTests();
    config.firebaseServiceAccountJson = original;
  }
});

void test('summarizeFcmSendFailures separates invalid tokens from other failure codes', () => {
  const responses = [
    {
      successCount: 1,
      failureCount: 3,
      responses: [
        { success: true, messageId: 'm1' },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: false, error: { code: 'messaging/third-party-auth-error' } },
        { success: false, error: {} },
      ],
    },
  ] as unknown as BatchResponse[];
  const tokenChunks = [['tok-good', 'tok-invalid', 'tok-auth', 'tok-unknown']];

  const summary = summarizeFcmSendFailures(responses, tokenChunks);

  assert.deepEqual(summary.invalidTokens, ['tok-invalid']);
  assert.deepEqual(summary.failuresByCode, {
    'messaging/third-party-auth-error': 1,
    unknown: 1,
  });
});

void test('summarizeFcmSendFailures dedupes invalid tokens and counts repeated codes', () => {
  const responses = [
    {
      successCount: 0,
      failureCount: 2,
      responses: [
        { success: false, error: { code: 'messaging/third-party-auth-error' } },
        { success: false, error: { code: 'messaging/invalid-registration-token' } },
      ],
    },
    {
      successCount: 0,
      failureCount: 2,
      responses: [
        { success: false, error: { code: 'messaging/third-party-auth-error' } },
        { success: false, error: { code: 'messaging/invalid-registration-token' } },
      ],
    },
  ] as unknown as BatchResponse[];
  const tokenChunks = [
    ['tok-auth', 'tok-dup'],
    ['tok-auth2', 'tok-dup'],
  ];

  const summary = summarizeFcmSendFailures(responses, tokenChunks);

  assert.deepEqual(summary.invalidTokens, ['tok-dup']);
  assert.deepEqual(summary.failuresByCode, { 'messaging/third-party-auth-error': 2 });
});

void test('sendFcmMulticast surfaces invalid Firebase service account JSON once configured', async () => {
  const original = config.firebaseServiceAccountJson;
  try {
    resetFcmStateForTests();
    config.firebaseServiceAccountJson = '{bad-json';

    await assert.rejects(
      () =>
        sendFcmMulticast(['token-1'], {
          title: 't',
          body: 'b',
          data: { eventType: 'test' },
        }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        if (error instanceof Error) {
          assert.match(error.message, /Invalid FIREBASE_SERVICE_ACCOUNT_JSON/);
        }
        return true;
      }
    );
  } finally {
    resetFcmStateForTests();
    config.firebaseServiceAccountJson = original;
  }
});

void test('sendFcmMulticast continues rejecting after an initial parse failure', async () => {
  const original = config.firebaseServiceAccountJson;
  try {
    resetFcmStateForTests();
    config.firebaseServiceAccountJson = '{bad-json';

    await assert.rejects(() =>
      sendFcmMulticast(['token-1'], {
        title: 't',
        body: 'b',
        data: { eventType: 'test' },
      })
    );

    await assert.rejects(() =>
      sendFcmMulticast(['token-2'], {
        title: 't',
        body: 'b',
        data: { eventType: 'test' },
      })
    );
  } finally {
    resetFcmStateForTests();
    config.firebaseServiceAccountJson = original;
  }
});
