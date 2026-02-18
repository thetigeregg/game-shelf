import { describe, expect, it, vi } from 'vitest';
import type { LoadingController } from '@ionic/angular/standalone';
import type { GameEntry } from '../../core/models/game.models';
import { runBulkActionWithRetry } from './game-list-bulk-actions';

function createGame(id: number): GameEntry {
  const now = new Date().toISOString();
  return {
    igdbGameId: String(id),
    title: `Game ${id}`,
    coverUrl: null,
    coverSource: 'none',
    platform: 'PC',
    platformIgdbId: 6,
    releaseDate: null,
    releaseYear: null,
    listType: 'collection',
    createdAt: now,
    updatedAt: now
  };
}

function createLoadingControllerStub(): LoadingController {
  const loading = {
    message: '',
    present: vi.fn(async () => undefined),
    dismiss: vi.fn(async () => undefined)
  };

  return {
    create: vi.fn(async () => loading)
  } as unknown as LoadingController;
}

describe('runBulkActionWithRetry', () => {
  it('continues processing queued games when one item times out', async () => {
    vi.useFakeTimers();

    const loadingController = createLoadingControllerStub();
    const games = [createGame(1), createGame(2), createGame(3)];
    const action = vi.fn((game: GameEntry) => {
      if (game.igdbGameId === '1') {
        return new Promise<GameEntry>(() => undefined);
      }

      return Promise.resolve(game);
    });

    const runPromise = runBulkActionWithRetry({
      loadingController,
      games,
      options: {
        loadingPrefix: 'Updating HLTB data',
        concurrency: 1,
        interItemDelayMs: 0,
        itemTimeoutMs: 25
      },
      retryConfig: {
        maxAttempts: 1,
        retryBaseDelayMs: 10,
        rateLimitFallbackCooldownMs: 100
      },
      action,
      delay: async () => undefined
    });

    await vi.advanceTimersByTimeAsync(60);
    const results = await runPromise;
    vi.useRealTimers();

    expect(action).toHaveBeenCalledTimes(3);
    expect(results.map((result) => result.ok)).toEqual([false, true, true]);
    expect(results[0].errorReason).toBe('transient');
    expect(results[1].value?.igdbGameId).toBe('2');
    expect(results[2].value?.igdbGameId).toBe('3');
  });

  it('retries transient failures and eventually succeeds', async () => {
    const loadingController = createLoadingControllerStub();
    const game = createGame(11);
    const delay = vi.fn(async () => undefined);
    const action = vi.fn(async () => {
      if (action.mock.calls.length === 1) {
        throw new Error('network unavailable');
      }

      return game;
    });

    const [result] = await runBulkActionWithRetry({
      loadingController,
      games: [game],
      options: {
        loadingPrefix: 'Updating HLTB data',
        concurrency: 1,
        interItemDelayMs: 0
      },
      retryConfig: {
        maxAttempts: 3,
        retryBaseDelayMs: 250,
        rateLimitFallbackCooldownMs: 1000
      },
      action,
      delay
    });

    expect(action).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(250);
    expect(result.ok).toBe(true);
    expect(result.value?.igdbGameId).toBe('11');
  });

  it('honors retry-after on rate-limits and classifies final failures', async () => {
    const loadingController = createLoadingControllerStub();
    const game = createGame(12);
    const delay = vi.fn(async () => undefined);
    const action = vi.fn(async () => {
      throw new Error('429 too many requests, retry after 4 s');
    });

    const [result] = await runBulkActionWithRetry({
      loadingController,
      games: [game],
      options: {
        loadingPrefix: 'Updating HLTB data',
        concurrency: 1,
        interItemDelayMs: 0
      },
      retryConfig: {
        maxAttempts: 2,
        retryBaseDelayMs: 250,
        rateLimitFallbackCooldownMs: 10000
      },
      action,
      delay
    });

    expect(action).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(4000);
    expect(result.ok).toBe(false);
    expect(result.errorReason).toBe('rate_limit');
  });

  it('classifies non-retryable failures as other', async () => {
    const loadingController = createLoadingControllerStub();
    const game = createGame(13);
    const delay = vi.fn(async () => undefined);
    const action = vi.fn(async () => {
      throw new Error('validation failed');
    });

    const [result] = await runBulkActionWithRetry({
      loadingController,
      games: [game],
      options: {
        loadingPrefix: 'Updating HLTB data',
        concurrency: 1,
        interItemDelayMs: 0
      },
      retryConfig: {
        maxAttempts: 3,
        retryBaseDelayMs: 250,
        rateLimitFallbackCooldownMs: 1000
      },
      action,
      delay
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.errorReason).toBe('other');
  });
});
