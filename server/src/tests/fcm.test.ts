import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../config.js';
import { hasConfiguredFcm, resetFcmStateForTests, sendFcmMulticast } from '../fcm.js';

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
      data: { route: '/tabs/wishlist' }
    });
    assert.deepEqual(emptyResult, {
      successCount: 0,
      failureCount: 0,
      invalidTokens: []
    });

    const noConfigResult = await sendFcmMulticast(['token-1', 'token-1', 'token-2'], {
      title: 't',
      body: 'b',
      data: { eventType: 'test' }
    });
    assert.deepEqual(noConfigResult, {
      successCount: 0,
      failureCount: 2,
      invalidTokens: []
    });
  } finally {
    resetFcmStateForTests();
    config.firebaseServiceAccountJson = original;
  }
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
          data: { eventType: 'test' }
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
        data: { eventType: 'test' }
      })
    );

    await assert.rejects(() =>
      sendFcmMulticast(['token-2'], {
        title: 't',
        body: 'b',
        data: { eventType: 'test' }
      })
    );
  } finally {
    resetFcmStateForTests();
    config.firebaseServiceAccountJson = original;
  }
});
