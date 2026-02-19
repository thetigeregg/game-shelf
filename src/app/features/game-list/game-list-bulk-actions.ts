import type { LoadingController } from '@ionic/angular/standalone';
import { GameEntry } from '../../core/models/game.models';
import {
  extractRetryAfterSeconds,
  isRateLimitedMessage,
  isTransientNetworkMessage
} from '../../core/utils/rate-limit-ui-error';

export interface BulkActionResult<T> {
  game: GameEntry;
  ok: boolean;
  value: T | null;
  errorReason?: 'rate_limit' | 'transient' | 'other';
}

export interface BulkActionOptions {
  loadingPrefix: string;
  concurrency: number;
  interItemDelayMs: number;
  itemTimeoutMs?: number;
}

export interface BulkActionRetryConfig {
  maxAttempts: number;
  retryBaseDelayMs: number;
  rateLimitFallbackCooldownMs: number;
}

export async function runBulkActionWithRetry<T>(params: {
  loadingController: LoadingController;
  games: GameEntry[];
  options: BulkActionOptions;
  retryConfig: BulkActionRetryConfig;
  action: (game: GameEntry) => Promise<T>;
  delay: (ms: number) => Promise<void>;
}): Promise<BulkActionResult<T>[]> {
  const { loadingController, games, options, retryConfig, action, delay } = params;
  const loading = await loadingController.create({
    message: `${options.loadingPrefix} 0/${games.length}...`,
    spinner: 'crescent',
    backdropDismiss: false
  });
  await loading.present();

  const results: BulkActionResult<T>[] = new Array(games.length);
  const queue = games.map((game, index) => ({ game, index }));
  const workerCount = Math.max(1, Math.min(options.concurrency, queue.length));
  let completed = 0;

  const updateLoadingMessage = (message: string): void => {
    loading.message = message;
  };

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const entry = queue.shift();

      if (!entry) {
        return;
      }

      const outcome = await executeBulkActionWithRetry(
        entry.game,
        action,
        retryConfig,
        options.itemTimeoutMs,
        delay,
        updateLoadingMessage
      );
      results[entry.index] = outcome;
      completed += 1;
      updateLoadingMessage(`${options.loadingPrefix} ${completed}/${games.length}...`);

      if (options.interItemDelayMs > 0 && completed < games.length) {
        await delay(options.interItemDelayMs);
      }
    }
  });

  await Promise.all(workers);
  await loading.dismiss().catch(() => undefined);
  return results;
}

async function executeBulkActionWithRetry<T>(
  game: GameEntry,
  action: (game: GameEntry) => Promise<T>,
  retryConfig: BulkActionRetryConfig,
  itemTimeoutMs: number | undefined,
  delay: (ms: number) => Promise<void>,
  setLoadingMessage: (message: string) => void
): Promise<BulkActionResult<T>> {
  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt += 1) {
    try {
      const value = await withOptionalTimeout(
        action(game),
        itemTimeoutMs,
        `Bulk action timed out after ${itemTimeoutMs}ms`
      );
      return { game, ok: true, value };
    } catch (error: unknown) {
      if (!shouldRetryBulkActionError(error, attempt, retryConfig)) {
        return { game, ok: false, value: null, errorReason: classifyBulkError(error) };
      }

      const retryDelayMs = resolveBulkRetryDelayMs(error, attempt, retryConfig);
      const reason = isRateLimitError(error) ? 'rate limit' : 'temporary error';
      const safeTitle = truncateTitleForLoading(game.title);
      setLoadingMessage(
        `Retrying ${safeTitle} due to ${reason} in ${Math.max(1, Math.ceil(retryDelayMs / 1000))}s...`
      );
      await delay(retryDelayMs);
    }
  }

  return { game, ok: false, value: null, errorReason: 'other' };
}

async function withOptionalTimeout<T>(
  task: Promise<T>,
  timeoutMs: number | undefined,
  timeoutMessage: string
): Promise<T> {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return task;
  }

  let timeoutId: number | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

function shouldRetryBulkActionError(
  error: unknown,
  attempt: number,
  retryConfig: BulkActionRetryConfig
): boolean {
  if (attempt >= retryConfig.maxAttempts) {
    return false;
  }

  const message = error instanceof Error ? error.message : '';

  if (isRateLimitError(error)) {
    return true;
  }

  return isTransientNetworkMessage(message.toLowerCase());
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return isRateLimitedMessage(message);
}

function classifyBulkError(error: unknown): 'rate_limit' | 'transient' | 'other' {
  if (isRateLimitError(error)) {
    return 'rate_limit';
  }

  const message = error instanceof Error ? error.message : '';

  if (isTransientNetworkMessage(message.toLowerCase())) {
    return 'transient';
  }

  return 'other';
}

function resolveBulkRetryDelayMs(
  error: unknown,
  attempt: number,
  retryConfig: BulkActionRetryConfig
): number {
  const message = error instanceof Error ? error.message : '';
  const seconds = extractRetryAfterSeconds(message);

  if (seconds !== null) {
    return Math.min(seconds * 1000, retryConfig.rateLimitFallbackCooldownMs);
  }

  if (isRateLimitError(error)) {
    return retryConfig.rateLimitFallbackCooldownMs;
  }

  return Math.min(
    retryConfig.retryBaseDelayMs * 2 ** (attempt - 1),
    retryConfig.rateLimitFallbackCooldownMs
  );
}

function truncateTitleForLoading(title: string): string {
  const normalized = String(title ?? '').trim();

  if (normalized.length <= 32) {
    return normalized || 'game';
  }

  return `${normalized.slice(0, 29)}...`;
}
