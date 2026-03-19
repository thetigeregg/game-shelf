import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmptyProviderRetryState,
  hasMeaningfulRetryState,
  maybeRearmProviderRetryState,
  nextProviderRetryState,
  parseProviderRetryState,
  shouldAttemptProvider,
} from './provider-retry-state.js';

void test('parseProviderRetryState normalizes invalid values to an empty state', () => {
  assert.deepEqual(parseProviderRetryState('bad-input'), createEmptyProviderRetryState());
  assert.deepEqual(
    parseProviderRetryState({
      attempts: -2,
      lastTriedAt: 'not-a-date',
      nextTryAt: 'still-not-a-date',
      permanentMiss: 'yes',
    }),
    createEmptyProviderRetryState()
  );
});

void test('parseProviderRetryState keeps meaningful retry values', () => {
  const parsed = parseProviderRetryState({
    attempts: 2,
    lastTriedAt: '2026-03-10T00:00:00.000Z',
    nextTryAt: '2026-03-11T00:00:00.000Z',
    permanentMiss: true,
  });

  assert.deepEqual(parsed, {
    attempts: 2,
    lastTriedAt: '2026-03-10T00:00:00.000Z',
    nextTryAt: '2026-03-11T00:00:00.000Z',
    permanentMiss: true,
  });
  assert.equal(hasMeaningfulRetryState(parsed), true);
  assert.equal(hasMeaningfulRetryState(createEmptyProviderRetryState()), false);
});

void test('shouldAttemptProvider blocks permanent miss, max attempts, and future backoff windows', () => {
  const nowMs = Date.parse('2026-03-18T12:00:00.000Z');

  assert.equal(
    shouldAttemptProvider({
      state: {
        attempts: 1,
        lastTriedAt: '2026-03-18T11:00:00.000Z',
        nextTryAt: null,
        permanentMiss: true,
      },
      nowMs,
      maxAttempts: 5,
    }),
    false
  );

  assert.equal(
    shouldAttemptProvider({
      state: {
        attempts: 5,
        lastTriedAt: '2026-03-18T11:00:00.000Z',
        nextTryAt: null,
        permanentMiss: false,
      },
      nowMs,
      maxAttempts: 5,
    }),
    false
  );

  assert.equal(
    shouldAttemptProvider({
      state: {
        attempts: 2,
        lastTriedAt: '2026-03-18T11:00:00.000Z',
        nextTryAt: '2026-03-18T12:30:00.000Z',
        permanentMiss: false,
      },
      nowMs,
      maxAttempts: 5,
    }),
    false
  );

  assert.equal(
    shouldAttemptProvider({
      state: {
        attempts: 2,
        lastTriedAt: '2026-03-18T11:00:00.000Z',
        nextTryAt: '2026-03-18T11:30:00.000Z',
        permanentMiss: false,
      },
      nowMs,
      maxAttempts: 5,
    }),
    true
  );
});

void test('nextProviderRetryState resets on success and escalates failures into backoff and permanent miss', () => {
  assert.deepEqual(
    nextProviderRetryState({
      current: {
        attempts: 3,
        lastTriedAt: '2026-03-17T00:00:00.000Z',
        nextTryAt: '2026-03-18T00:00:00.000Z',
        permanentMiss: true,
      },
      nowIso: '2026-03-18T12:00:00.000Z',
      success: true,
      maxAttempts: 4,
      backoffBaseMinutes: 10,
      backoffMaxHours: 12,
    }),
    {
      attempts: 0,
      lastTriedAt: '2026-03-18T12:00:00.000Z',
      nextTryAt: null,
      permanentMiss: false,
    }
  );

  assert.deepEqual(
    nextProviderRetryState({
      current: createEmptyProviderRetryState(),
      nowIso: '2026-03-18T12:00:00.000Z',
      success: false,
      maxAttempts: 4,
      backoffBaseMinutes: 10,
      backoffMaxHours: 12,
    }),
    {
      attempts: 1,
      lastTriedAt: '2026-03-18T12:00:00.000Z',
      nextTryAt: '2026-03-18T12:10:00.000Z',
      permanentMiss: false,
    }
  );

  assert.deepEqual(
    nextProviderRetryState({
      current: {
        attempts: 3,
        lastTriedAt: '2026-03-18T11:00:00.000Z',
        nextTryAt: '2026-03-18T11:40:00.000Z',
        permanentMiss: false,
      },
      nowIso: '2026-03-18T12:00:00.000Z',
      success: false,
      maxAttempts: 4,
      backoffBaseMinutes: 10,
      backoffMaxHours: 12,
    }),
    {
      attempts: 4,
      lastTriedAt: '2026-03-18T12:00:00.000Z',
      nextTryAt: null,
      permanentMiss: true,
    }
  );
});

void test('maybeRearmProviderRetryState rearms only capped recent-release states after the delay', () => {
  const nowMs = Date.parse('2026-03-18T12:00:00.000Z');
  const cappedState = {
    attempts: 4,
    lastTriedAt: '2026-02-01T00:00:00.000Z',
    nextTryAt: null,
    permanentMiss: true,
  };

  assert.deepEqual(
    maybeRearmProviderRetryState({
      state: cappedState,
      nowMs,
      releaseYear: 2026,
      rearmAfterDays: 7,
      rearmRecentReleaseYears: 2,
      maxAttempts: 4,
    }),
    createEmptyProviderRetryState()
  );

  assert.deepEqual(
    maybeRearmProviderRetryState({
      state: cappedState,
      nowMs,
      releaseYear: 2022,
      rearmAfterDays: 7,
      rearmRecentReleaseYears: 2,
      maxAttempts: 4,
    }),
    cappedState
  );

  const recentAttemptState = {
    ...cappedState,
    lastTriedAt: '2026-03-16T12:00:00.000Z',
  };
  assert.deepEqual(
    maybeRearmProviderRetryState({
      state: recentAttemptState,
      nowMs,
      releaseYear: 2026,
      rearmAfterDays: 7,
      rearmRecentReleaseYears: 2,
      maxAttempts: 4,
    }),
    recentAttemptState
  );

  const uncappedState = {
    attempts: 1,
    lastTriedAt: '2026-03-17T12:00:00.000Z',
    nextTryAt: '2026-03-17T13:00:00.000Z',
    permanentMiss: false,
  };
  assert.deepEqual(
    maybeRearmProviderRetryState({
      state: uncappedState,
      nowMs,
      releaseYear: 2026,
      rearmAfterDays: 7,
      rearmRecentReleaseYears: 2,
      maxAttempts: 4,
    }),
    uncappedState
  );
});
