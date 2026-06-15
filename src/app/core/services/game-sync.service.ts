import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { OutboxEntry, SyncMetaEntry } from '../data/app-db';
import { STORAGE_ENGINE, isStorageConstraintError } from '../data/storage-engine';
import { SyncOutboxWriteRequest, SyncOutboxWriter } from '../data/sync-outbox-writer';
import {
  ClientSyncOperation,
  DEFAULT_GAME_LIST_FILTERS,
  GameEntry,
  GameListView,
  GameWebsite,
  SyncChangeEvent,
  SyncPushResult,
  Tag,
  isGameRating,
} from '../models/game.models';
import { environment } from '../../../environments/environment';
import { SyncEventsService } from './sync-events.service';
import { SyncBootstrapProgressService } from './sync-bootstrap-progress.service';
import { PlatformOrderService, PLATFORM_ORDER_STORAGE_KEY } from './platform-order.service';
import {
  PlatformCustomizationService,
  PLATFORM_DISPLAY_NAMES_STORAGE_KEY,
} from './platform-customization.service';
import { HtmlSanitizerService } from '../security/html-sanitizer.service';
import { DebugLogService } from './debug-log.service';
import { normalizeHttpError } from '../utils/normalize-http-error';
import { detectReviewSourceFromUrl, sanitizeExternalHttpUrlString } from '../utils/url-host.util';
import { normalizeGameScreenshots, normalizeGameVideos } from '../utils/game-media-normalization';
import { buildOutboxEntry, generateOperationId } from '../data/outbox-entry.util';
import { NetworkConnectivityService } from './network-connectivity.service';
import { PreferenceStorageService } from '../storage/preference-storage.service';
import { RuntimeAvailabilityService } from './runtime-availability.service';

interface SyncPushResponse {
  results: SyncPushResult[];
  cursor?: string;
}

interface SyncPullResponse {
  cursor: string;
  changes: SyncChangeEvent[];
}

interface PulledGameNormalizeContext {
  existingByIdentity?: GameEntry;
  hasPendingLocalWrite: boolean;
  serverId: number | null;
  serverIdCanBeReused: boolean;
}

export interface SyncReloadSummary {
  connectivity: string | null;
  isSyncInFlight: boolean;
  pendingOutboxCount: number;
  lastSyncAt: string | null;
}

export const DISCOVERY_POLLUTION_REMEDIATION_META_KEY = 'discoveryPollutionRemediationV1';

@Injectable({ providedIn: 'root' })
export class GameSyncService implements SyncOutboxWriter {
  private static readonly SYNC_INTERVAL_MS = 30_000;
  private static readonly SYNC_PULL_PAGE_SIZE = 1000;
  private static readonly SYNC_PULL_MAX_PAGES_PER_RUN = 20;
  private static readonly MAX_PUSH_BODY_BYTES = 8 * 1024 * 1024;
  private static readonly PUSH_BODY_PREFIX_BYTES = '{"operations":['.length;
  private static readonly PUSH_BODY_SUFFIX_BYTES = ']}'.length;
  private static readonly META_CURSOR_KEY = 'cursor';
  private static readonly META_BOOTSTRAP_KEY = 'bootstrapV1';
  private static readonly META_LAST_SYNC_KEY = 'lastSyncAt';
  private static readonly META_CONNECTIVITY_KEY = 'connectivity';
  private static readonly META_RECENT_REPLAY_LAST_ATTEMPT_AT_KEY = 'recentReplayLastAttemptAt';
  private static readonly META_RECENT_REPLAY_LAST_AT_KEY = 'recentReplayLastAt';
  private static readonly RECENT_REPLAY_INTERVAL_MS = 24 * 60 * 60 * 1000;
  private static readonly RECENT_REPLAY_WINDOW_EVENTS = 5000;
  private static readonly RECENT_REPLAY_MAX_PAGES = 5;

  private readonly engine = inject(STORAGE_ENGINE);
  private readonly httpClient = inject(HttpClient);
  private readonly syncEvents = inject(SyncEventsService);
  private readonly syncBootstrapProgress = inject(SyncBootstrapProgressService);
  private readonly platformOrderService = inject(PlatformOrderService);
  private readonly platformCustomizationService = inject(PlatformCustomizationService);
  private readonly htmlSanitizer = inject(HtmlSanitizerService);
  private readonly debugLogService = inject(DebugLogService);
  private readonly preferenceStorage = inject(PreferenceStorageService);
  private readonly networkConnectivity = inject(NetworkConnectivityService);
  private readonly runtimeAvailability = inject(RuntimeAvailabilityService);
  private readonly baseUrl = this.normalizeBaseUrl(environment.gameApiBaseUrl);
  private initialized = false;
  private syncInFlight = false;
  private activeSyncPromise: Promise<void> | null = null;
  private resetLocalSyncStatePromise: Promise<boolean> | null = null;
  private intervalId: number | null = null;

  initialize(): void {
    if (this.initialized) {
      this.debugLogService.debug('sync.initialize.skipped_already_initialized');
      return;
    }

    this.initialized = true;
    this.debugLogService.debug('sync.initialize.start', {
      baseUrl: this.baseUrl,
      online: this.isOnline(),
    });

    this.networkConnectivity.onConnectedChange((connected) => {
      if (connected) {
        void this.setMeta(GameSyncService.META_CONNECTIVITY_KEY, 'online');
        void this.syncNow();
        return;
      }

      void this.setMeta(GameSyncService.META_CONNECTIVITY_KEY, 'offline');
    });

    this.runtimeAvailability.onStatusChange((status) => {
      if (status === 'online') {
        void this.syncNow();
      }
    });

    if (typeof window !== 'undefined') {
      this.intervalId = window.setInterval(() => {
        void this.syncNow();
      }, GameSyncService.SYNC_INTERVAL_MS);
    }

    void this.requestPersistentStorage();
    void this.setMeta(
      GameSyncService.META_CONNECTIVITY_KEY,
      this.isOnline() ? 'online' : 'offline'
    );
    void this.runDiscoveryPollutionRemediationIfNeeded()
      .catch((error: unknown) => {
        this.debugLogService.error('sync.discovery_pollution_remediation_failed', {
          error: normalizeHttpError(error),
        });
      })
      .finally(() => {
        void this.syncNow();
      });
  }

  async resetLocalSyncState(): Promise<boolean> {
    if (this.resetLocalSyncStatePromise) {
      return this.resetLocalSyncStatePromise;
    }

    const now = new Date().toISOString();

    this.resetLocalSyncStatePromise = (async (): Promise<boolean> => {
      try {
        if (this.activeSyncPromise) {
          await this.activeSyncPromise;
        }

        await this.engine.runInTransaction(['syncMeta'], async () => {
          await this.engine.putSyncMeta({
            key: GameSyncService.META_CURSOR_KEY,
            value: '0',
            updatedAt: now,
          });
          await this.engine.deleteSyncMeta(GameSyncService.META_LAST_SYNC_KEY);
          await this.engine.deleteSyncMeta(GameSyncService.META_RECENT_REPLAY_LAST_ATTEMPT_AT_KEY);
          await this.engine.deleteSyncMeta(GameSyncService.META_RECENT_REPLAY_LAST_AT_KEY);
        });

        this.debugLogService.info('sync.local_state_reset');
        return await this.startSyncNowIfPossible(false);
      } finally {
        this.resetLocalSyncStatePromise = null;
      }
    })();

    return this.resetLocalSyncStatePromise;
  }

  async enqueueOperation(request: SyncOutboxWriteRequest): Promise<void> {
    const entry = buildOutboxEntry(request, () => this.generateOperationId());

    await this.engine.putOutboxEntry(entry);
    try {
      this.onOutboxEntryEnqueued(entry);
    } catch {
      // Keep outbox enqueue resilient if optional observability logic throws.
    }
    void this.syncNow();
  }

  onOutboxEntryEnqueued(entry: OutboxEntry): void {
    this.debugLogService.debug('sync.outbox.enqueued', {
      opId: entry.opId,
      entityType: entry.entityType,
      operation: entry.operation,
    });
  }

  async syncNow(): Promise<void> {
    try {
      const syncStarted = await this.startSyncNowIfPossible();

      if (!syncStarted || !this.activeSyncPromise) {
        return;
      }

      await this.activeSyncPromise;
    } catch {
      this.debugLogService.debug('sync.sync_now.failed');
    }
  }

  async hasPendingSyncWork(): Promise<boolean> {
    if (this.resetLocalSyncStatePromise || this.syncInFlight || this.activeSyncPromise) {
      return true;
    }

    return (await this.engine.countOutbox()) > 0;
  }

  async flushPendingSyncForReload(): Promise<boolean> {
    while (this.resetLocalSyncStatePromise) {
      try {
        await this.resetLocalSyncStatePromise;
      } catch {
        return false;
      }
    }

    await this.syncNow();
    return !(await this.hasPendingSyncWork());
  }

  async getReloadSummary(): Promise<SyncReloadSummary> {
    const [pendingOutboxCount, connectivity, lastSyncAt] = await Promise.all([
      this.engine.countOutbox(),
      this.getMeta(GameSyncService.META_CONNECTIVITY_KEY),
      this.getMeta(GameSyncService.META_LAST_SYNC_KEY),
    ]);

    return {
      connectivity,
      isSyncInFlight:
        this.resetLocalSyncStatePromise !== null ||
        this.syncInFlight ||
        this.activeSyncPromise !== null,
      pendingOutboxCount,
      lastSyncAt,
    };
  }

  private async startSyncNowIfPossible(waitForReset = true): Promise<boolean> {
    while (waitForReset && this.resetLocalSyncStatePromise) {
      try {
        await this.resetLocalSyncStatePromise;
      } catch {
        this.debugLogService.debug('sync.reset_local_state.failed');
        return false;
      }
    }

    if (this.syncInFlight) {
      this.debugLogService.debug('sync.sync_now.skipped_in_flight');
      return false;
    }

    if (!this.isOnline()) {
      this.debugLogService.debug('sync.sync_now.skipped_offline');
      return false;
    }

    if (!this.isApiReachable()) {
      this.debugLogService.debug('sync.sync_now.skipped_unreachable');
      return false;
    }

    this.debugLogService.debug('sync.sync_now.start');
    this.syncInFlight = true;

    this.activeSyncPromise = this.runSyncNow();
    return true;
  }

  private async runSyncNow(): Promise<void> {
    try {
      await this.pushOutbox();
      await this.beginInitialLoadProgressIfNeeded();
      await this.pullChanges();
      await this.replayRecentChangesIfDue().catch((error: unknown) => {
        this.debugLogService.error('sync.pull.recent_replay_failed', {
          error: normalizeHttpError(error),
        });
      });
      await this.setMeta(GameSyncService.META_LAST_SYNC_KEY, new Date().toISOString());
      await this.setMeta(GameSyncService.META_CONNECTIVITY_KEY, 'online');
      this.debugLogService.debug('sync.sync_now.success');
    } catch (error: unknown) {
      await this.setMeta(GameSyncService.META_CONNECTIVITY_KEY, 'degraded');
      this.debugLogService.error('sync.sync_now.failed', {
        error: normalizeHttpError(error),
      });
    } finally {
      this.syncInFlight = false;
      this.activeSyncPromise = null;
    }
  }

  private async pushOutbox(): Promise<void> {
    const entries = await this.engine.listOutboxOrderedByCreatedAt();

    if (entries.length === 0) {
      this.debugLogService.debug('sync.push.skipped_empty_outbox');
      return;
    }
    this.debugLogService.debug('sync.push.start', { count: entries.length });

    const operations: ClientSyncOperation[] = entries.map((entry) => ({
      opId: entry.opId,
      entityType: entry.entityType,
      operation: entry.operation,
      payload: entry.payload,
      clientTimestamp: entry.clientTimestamp,
    }));
    const operationBatches = this.buildPushOperationBatches(
      operations,
      GameSyncService.MAX_PUSH_BODY_BYTES
    );
    const ackedIds = new Set<string>();
    const failedResults: SyncPushResult[] = [];

    for (const batch of operationBatches) {
      this.debugLogService.debug('sync.push.batch.request', { batchSize: batch.length });
      const response = await firstValueFrom(
        this.httpClient.post<SyncPushResponse>(`${this.baseUrl}/v1/sync/push`, {
          operations: batch,
        })
      );
      this.debugLogService.debug('sync.push.batch.response', {
        batchSize: batch.length,
        results: Array.isArray(response.results) ? response.results.length : 0,
        hasCursor: typeof response.cursor === 'string' && response.cursor.trim().length > 0,
      });

      const batchResults = Array.isArray(response.results) ? response.results : [];

      batchResults
        .filter((result) => result.status === 'applied' || result.status === 'duplicate')
        .map((result) => result.opId)
        .filter((opId) => typeof opId === 'string' && opId.trim().length > 0)
        .forEach((opId) => ackedIds.add(opId));

      failedResults.push(...batchResults.filter((result) => result.status === 'failed'));
    }

    if (ackedIds.size > 0) {
      await this.engine.bulkDeleteOutbox([...ackedIds]);
    }
    this.debugLogService.debug('sync.push.complete', {
      acked: ackedIds.size,
      failed: failedResults.length,
    });

    for (const failure of failedResults) {
      const existing = await this.engine.getOutboxEntry(failure.opId);

      if (!existing) {
        continue;
      }

      await this.engine.putOutboxEntry({
        ...existing,
        attemptCount: existing.attemptCount + 1,
        lastError: failure.message ?? 'Failed to push operation.',
      });
    }
  }

  private buildPushOperationBatches(
    operations: ClientSyncOperation[],
    maxBodyBytes: number
  ): ClientSyncOperation[][] {
    const batches: ClientSyncOperation[][] = [];
    let currentBatch: ClientSyncOperation[] = [];
    let currentBatchBytes =
      GameSyncService.PUSH_BODY_PREFIX_BYTES + GameSyncService.PUSH_BODY_SUFFIX_BYTES;

    for (const operation of operations) {
      const operationBytes = JSON.stringify(operation).length;
      const commaBytes = currentBatch.length > 0 ? 1 : 0;
      const nextBatchBytes = currentBatchBytes + commaBytes + operationBytes;

      if (nextBatchBytes <= maxBodyBytes || currentBatch.length === 0) {
        currentBatch.push(operation);
        currentBatchBytes = nextBatchBytes;
        continue;
      }

      batches.push(currentBatch);
      currentBatch = [operation];
      currentBatchBytes =
        GameSyncService.PUSH_BODY_PREFIX_BYTES +
        GameSyncService.PUSH_BODY_SUFFIX_BYTES +
        operationBytes;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  private async pullChanges(): Promise<void> {
    const trackInitialLoad = await this.shouldTrackInitialLoadProgress();
    if (trackInitialLoad) {
      await this.beginInitialLoadProgressIfNeeded();
    }
    let cursor = await this.getMeta(GameSyncService.META_CURSOR_KEY);
    let pagesPulled = 0;
    let totalAppliedChanges = 0;
    let caughtUp = false;

    try {
      while (pagesPulled < GameSyncService.SYNC_PULL_MAX_PAGES_PER_RUN) {
        this.debugLogService.debug('sync.pull.request', {
          hasCursor: Boolean(cursor),
          cursor,
          pagesPulled,
        });
        const response = await firstValueFrom(
          this.httpClient.post<SyncPullResponse>(`${this.baseUrl}/v1/sync/pull`, {
            cursor: cursor ?? null,
          })
        );

        const changes = Array.isArray(response.changes) ? response.changes : [];
        const responseCursor =
          typeof response.cursor === 'string' && response.cursor.trim().length > 0
            ? response.cursor.trim()
            : null;

        this.debugLogService.debug('sync.pull.response', {
          changes: changes.length,
          hasCursor: responseCursor !== null,
          requestedCursor: cursor,
          responseCursor,
        });

        if (changes.length === 0) {
          if (responseCursor !== null) {
            await this.setMeta(GameSyncService.META_CURSOR_KEY, responseCursor);
          }
          caughtUp = true;
          break;
        }

        await this.applyPulledChanges(changes);

        if (this.syncBootstrapProgress.progress().active) {
          const gameCount = await this.engine.countGames();
          this.syncBootstrapProgress.updateGamesLoaded(gameCount);
        }

        const nextCursor = responseCursor ?? changes[changes.length - 1].eventId;
        await this.setMeta(GameSyncService.META_CURSOR_KEY, nextCursor);
        totalAppliedChanges += changes.length;
        pagesPulled += 1;

        if (changes.length < GameSyncService.SYNC_PULL_PAGE_SIZE) {
          caughtUp = true;
          break;
        }

        if (cursor === nextCursor) {
          caughtUp = true;
          break;
        }

        cursor = nextCursor;
      }

      if (totalAppliedChanges > 0) {
        this.syncEvents.emitChanged();
        this.debugLogService.debug('sync.pull.applied', {
          changes: totalAppliedChanges,
          pagesPulled,
        });
      }

      if (caughtUp) {
        await this.completeInitialLibraryLoadIfPending();
      }
    } finally {
      if (caughtUp && this.syncBootstrapProgress.progress().active) {
        this.syncBootstrapProgress.finish();
      }
    }
  }

  private async replayRecentChangesIfDue(): Promise<void> {
    const cursorValue = await this.getMeta(GameSyncService.META_CURSOR_KEY);
    const cursor = this.parseNonNegativeInteger(cursorValue);

    if (cursor === null || cursor <= GameSyncService.RECENT_REPLAY_WINDOW_EVENTS) {
      return;
    }

    const pendingOutboxCount = await this.engine.countOutbox();
    if (pendingOutboxCount > 0) {
      this.debugLogService.debug('sync.pull.recent_replay.skipped_pending_outbox', {
        pendingOutboxCount,
      });
      return;
    }

    const lastReplayAttemptAt = this.getIsoDateMs(
      (await this.getMeta(GameSyncService.META_RECENT_REPLAY_LAST_ATTEMPT_AT_KEY)) ??
        (await this.getMeta(GameSyncService.META_RECENT_REPLAY_LAST_AT_KEY))
    );
    const now = Date.now();

    if (
      lastReplayAttemptAt !== null &&
      now - lastReplayAttemptAt < GameSyncService.RECENT_REPLAY_INTERVAL_MS
    ) {
      return;
    }

    const attemptAt = new Date().toISOString();
    let replayCursor = String(Math.max(0, cursor - GameSyncService.RECENT_REPLAY_WINDOW_EVENTS));
    let pagesPulled = 0;
    let totalAppliedChanges = 0;
    const replayPages: SyncChangeEvent[][] = [];
    let abortedDueToPendingOutbox = false;

    try {
      while (pagesPulled < GameSyncService.RECENT_REPLAY_MAX_PAGES) {
        const pendingOutboxCountBeforeRequest = await this.engine.countOutbox();
        if (pendingOutboxCountBeforeRequest > 0) {
          this.debugLogService.debug('sync.pull.recent_replay.skipped_pending_outbox', {
            pendingOutboxCount: pendingOutboxCountBeforeRequest,
          });
          abortedDueToPendingOutbox = true;
          break;
        }

        this.debugLogService.debug('sync.pull.recent_replay.request', {
          replayCursor,
          pagesPulled,
        });

        const response = await firstValueFrom(
          this.httpClient.post<SyncPullResponse>(`${this.baseUrl}/v1/sync/pull`, {
            cursor: replayCursor,
          })
        );
        const changes = Array.isArray(response.changes) ? response.changes : [];
        const responseCursor =
          typeof response.cursor === 'string' && response.cursor.trim().length > 0
            ? response.cursor.trim()
            : null;

        if (changes.length === 0) {
          break;
        }

        replayPages.push(changes);
        pagesPulled += 1;

        const nextCursor = responseCursor ?? changes[changes.length - 1].eventId;
        if (nextCursor === replayCursor || changes.length < GameSyncService.SYNC_PULL_PAGE_SIZE) {
          break;
        }

        replayCursor = nextCursor;
      }

      if (abortedDueToPendingOutbox || replayPages.length === 0) {
        return;
      }

      const pendingOutboxCountBeforeApply = await this.engine.countOutbox();
      if (pendingOutboxCountBeforeApply > 0) {
        this.debugLogService.debug('sync.pull.recent_replay.skipped_pending_outbox', {
          pendingOutboxCount: pendingOutboxCountBeforeApply,
        });
        return;
      }

      for (const replayPage of replayPages) {
        await this.applyPulledChanges(replayPage);
        totalAppliedChanges += replayPage.length;
      }

      if (totalAppliedChanges > 0) {
        await this.setMeta(GameSyncService.META_RECENT_REPLAY_LAST_AT_KEY, attemptAt);
        this.syncEvents.emitChanged();
        this.debugLogService.debug('sync.pull.recent_replay.applied', {
          changes: totalAppliedChanges,
          pagesPulled,
        });
      }
    } finally {
      await this.setMeta(GameSyncService.META_RECENT_REPLAY_LAST_ATTEMPT_AT_KEY, attemptAt);
    }
  }

  private async applyPulledChanges(changes: SyncChangeEvent[]): Promise<void> {
    let failedChanges = 0;

    await this.engine.runInTransaction(['games', 'tags', 'views', 'outbox'], async () => {
      const pendingGameOutboxKeys = await this.loadPendingGameOutboxKeys();
      const identityCache = new Map(
        (await this.engine.listAllGames()).map((game) => [
          this.buildGameIdentityKey(game.igdbGameId, game.platformIgdbId),
          game,
        ])
      );
      const pendingGameUpserts: GameEntry[] = [];

      const flushGameUpserts = async (): Promise<void> => {
        if (pendingGameUpserts.length === 0) {
          return;
        }

        await this.engine.bulkPutGames(pendingGameUpserts);
        for (const game of pendingGameUpserts) {
          identityCache.set(this.buildGameIdentityKey(game.igdbGameId, game.platformIgdbId), game);
        }
        pendingGameUpserts.length = 0;
      };

      for (const change of changes) {
        try {
          if (change.entityType === 'game') {
            if (change.operation === 'upsert') {
              const prepared = await this.prepareGameUpsertFromChange(
                change,
                pendingGameOutboxKeys,
                identityCache
              );

              if (prepared) {
                const preparedIdentityKey = this.buildGameIdentityKey(
                  prepared.igdbGameId,
                  prepared.platformIgdbId
                );
                const pendingIndex = pendingGameUpserts.findIndex(
                  (game) =>
                    this.buildGameIdentityKey(game.igdbGameId, game.platformIgdbId) ===
                    preparedIdentityKey
                );

                if (pendingIndex >= 0) {
                  pendingGameUpserts[pendingIndex] = prepared;
                } else {
                  pendingGameUpserts.push(prepared);
                }

                identityCache.set(preparedIdentityKey, prepared);
              }
              continue;
            }

            await flushGameUpserts();
            await this.applyGameChange(change, pendingGameOutboxKeys, identityCache);
            continue;
          }

          await flushGameUpserts();

          if (change.entityType === 'tag') {
            await this.applyTagChange(change, identityCache);
            continue;
          }

          if (change.entityType === 'view') {
            await this.applyViewChange(change);
            continue;
          }

          this.applySettingChange(change);
        } catch (error: unknown) {
          failedChanges += 1;
          this.debugLogService.error('sync.pull.change_failed', {
            eventId: change.eventId,
            entityType: change.entityType,
            operation: change.operation,
            error: normalizeHttpError(error),
          });
        }
      }

      await flushGameUpserts();

      if (failedChanges > 0) {
        throw new Error(`Failed to apply ${String(failedChanges)} pulled sync change(s).`);
      }
    });
  }

  private parsePositiveInteger(value: unknown): number | null {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : Number.NaN;

    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private parseNonNegativeInteger(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!/^\d+$/.test(trimmed)) {
        return null;
      }
      try {
        const parsed = BigInt(trimmed);
        if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
          return null;
        }
        return Number(parsed);
      } catch {
        return null;
      }
    }

    return null;
  }

  private getIsoDateMs(value: string | null): number | null {
    if (!value) {
      return null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async applyGameChange(
    change: SyncChangeEvent,
    pendingGameOutboxKeys?: ReadonlySet<string>,
    identityCache?: Map<string, GameEntry>
  ): Promise<void> {
    if (change.operation === 'delete') {
      const payload = change.payload as { igdbGameId?: unknown; platformIgdbId?: unknown };
      const igdbGameId = typeof payload.igdbGameId === 'string' ? payload.igdbGameId.trim() : '';
      const platformIgdbId = this.parsePositiveInteger(payload.platformIgdbId);

      if (!igdbGameId || platformIgdbId === null) {
        return;
      }

      const identityKey = this.buildGameIdentityKey(igdbGameId, platformIgdbId);
      const cachedForDelete = identityCache?.get(identityKey);
      const existing =
        cachedForDelete?.id !== undefined
          ? cachedForDelete
          : await this.engine.getGameByIdentity(igdbGameId, platformIgdbId);

      if (existing?.id !== undefined) {
        await this.engine.deleteGame(existing.id);
        identityCache?.delete(identityKey);
      }
      return;
    }

    const rawPayload =
      change.payload && typeof change.payload === 'object'
        ? (change.payload as Record<string, unknown>)
        : {};
    const pulledListType =
      typeof rawPayload['listType'] === 'string' ? rawPayload['listType'].trim() : '';

    const payload = rawPayload as Partial<GameEntry>;
    const igdbGameId = typeof payload.igdbGameId === 'string' ? payload.igdbGameId.trim() : '';
    const platformIgdbId = this.parsePositiveInteger(payload.platformIgdbId);

    if (!igdbGameId || platformIgdbId === null) {
      return;
    }

    if (pulledListType === 'discovery') {
      const hasPendingLocalWrite = await this.hasPendingGameOutboxOperation(
        igdbGameId,
        platformIgdbId,
        pendingGameOutboxKeys
      );

      if (hasPendingLocalWrite) {
        return;
      }

      const identityKey = this.buildGameIdentityKey(igdbGameId, platformIgdbId);
      const cachedForDiscovery = identityCache?.get(identityKey);
      const existingByIdentity =
        cachedForDiscovery?.id !== undefined
          ? cachedForDiscovery
          : await this.engine.getGameByIdentity(igdbGameId, platformIgdbId);

      if (existingByIdentity?.id !== undefined) {
        await this.engine.deleteGame(existingByIdentity.id);
        identityCache?.delete(identityKey);
      }
      return;
    }

    const prepared = await this.prepareGameUpsertFromChange(
      change,
      pendingGameOutboxKeys,
      identityCache ?? new Map<string, GameEntry>()
    );

    if (!prepared) {
      return;
    }

    try {
      await this.engine.putGame(prepared);
    } catch (error: unknown) {
      const serverId = this.parsePositiveInteger(payload.id);
      const shouldRetryWithoutServerId =
        serverId !== null && prepared.id === serverId && isStorageConstraintError(error);

      if (!shouldRetryWithoutServerId) {
        throw error;
      }

      await this.engine.putGame({
        ...prepared,
        id: undefined,
      });
    }
  }

  private async prepareGameUpsertFromChange(
    change: SyncChangeEvent,
    pendingGameOutboxKeys: ReadonlySet<string> | undefined,
    identityCache: Map<string, GameEntry>
  ): Promise<GameEntry | null> {
    const rawPayload =
      change.payload && typeof change.payload === 'object'
        ? (change.payload as Record<string, unknown>)
        : {};
    const pulledListType =
      typeof rawPayload['listType'] === 'string' ? rawPayload['listType'].trim() : '';

    if (pulledListType === 'discovery') {
      return null;
    }

    const payload = rawPayload as Partial<GameEntry>;
    const igdbGameId = typeof payload.igdbGameId === 'string' ? payload.igdbGameId.trim() : '';
    const platformIgdbId = this.parsePositiveInteger(payload.platformIgdbId);

    if (!igdbGameId || platformIgdbId === null) {
      return null;
    }

    const identityKey = this.buildGameIdentityKey(igdbGameId, platformIgdbId);
    const cachedExisting = identityCache.get(identityKey);
    const existingByIdentity =
      cachedExisting?.id !== undefined
        ? cachedExisting
        : await this.engine.getGameByIdentity(igdbGameId, platformIgdbId);
    const hasPendingLocalWrite = await this.hasPendingGameOutboxOperation(
      igdbGameId,
      platformIgdbId,
      pendingGameOutboxKeys
    );

    const serverId = this.parsePositiveInteger(payload.id);
    const existingByServerId =
      serverId !== null ? await this.engine.getGameById(serverId) : undefined;
    const serverIdCanBeReused =
      serverId !== null &&
      (existingByServerId === undefined ||
        (existingByServerId.igdbGameId === igdbGameId &&
          existingByServerId.platformIgdbId === platformIgdbId));

    const normalized = this.normalizePulledGamePayload(payload, pulledListType, {
      existingByIdentity,
      hasPendingLocalWrite,
      serverId,
      serverIdCanBeReused,
    });

    if (existingByIdentity?.id === undefined && normalized.id !== undefined) {
      return {
        ...normalized,
        id: undefined,
      };
    }

    return normalized;
  }

  private normalizeCustomTitle(value: unknown, defaultTitle: string): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    const normalizedDefault = typeof defaultTitle === 'string' ? defaultTitle.trim() : '';

    if (normalized.length === 0 || normalized === normalizedDefault) {
      return null;
    }

    return normalized;
  }

  private normalizeCustomPlatform(
    platformName: unknown,
    platformIgdbId: unknown,
    defaultPlatformName: unknown
  ): string | null {
    const normalizedName = typeof platformName === 'string' ? platformName.trim() : '';
    const normalizedPlatformId = this.normalizeOptionalPlatformIgdbId(platformIgdbId);
    const normalizedDefaultPlatformName =
      typeof defaultPlatformName === 'string' ? defaultPlatformName.trim() : '';

    if (
      normalizedName.length === 0 ||
      normalizedPlatformId === null ||
      normalizedName === normalizedDefaultPlatformName
    ) {
      return null;
    }

    return normalizedName;
  }

  private normalizeCustomPlatformIgdbId(
    platformIgdbId: unknown,
    platformName: unknown,
    defaultPlatformIgdbId: unknown,
    defaultPlatformName: unknown
  ): number | null {
    const normalizedPlatformId = this.normalizeOptionalPlatformIgdbId(platformIgdbId);
    const normalizedPlatformName = typeof platformName === 'string' ? platformName.trim() : '';
    const normalizedDefaultPlatformId = this.normalizeOptionalPlatformIgdbId(defaultPlatformIgdbId);
    const normalizedDefaultPlatformName =
      typeof defaultPlatformName === 'string' ? defaultPlatformName.trim() : '';

    if (normalizedPlatformId === null || normalizedPlatformName.length === 0) {
      return null;
    }

    if (
      normalizedDefaultPlatformId !== null &&
      normalizedPlatformId === normalizedDefaultPlatformId &&
      normalizedPlatformName === normalizedDefaultPlatformName
    ) {
      return null;
    }

    return normalizedPlatformId;
  }

  private normalizeOptionalPlatformIgdbId(value: unknown): number | null {
    return this.parsePositiveInteger(value);
  }

  private normalizeCustomCoverUrl(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (normalized.length === 0) {
      return null;
    }

    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)) {
      return normalized;
    }

    if (/^(https?:\/\/|\/\/)/i.test(normalized)) {
      return sanitizeExternalHttpUrlString(normalized);
    }

    return null;
  }

  private normalizeOptionalText(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeOptionalBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  private normalizeNullableIsoTimestamp(value: unknown): string | null {
    if (value === null) {
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (trimmed.length === 0) {
        return null;
      }

      const parsed = Date.parse(trimmed);

      if (Number.isNaN(parsed)) {
        return null;
      }

      return new Date(parsed).toISOString();
    }

    return null;
  }

  private normalizeExternalUrl(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (normalized.length === 0) {
      return null;
    }

    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      return normalized;
    }

    if (normalized.startsWith('//')) {
      return `https:${normalized}`;
    }

    return null;
  }

  private normalizeCompletionHours(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return Math.round(value * 10) / 10;
  }

  private normalizeMetacriticScore(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.round(value);
    return Number.isInteger(normalized) && normalized >= 1 && normalized <= 100 ? normalized : null;
  }

  private normalizeReviewScore(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) {
      return null;
    }

    return Math.round(value * 10) / 10;
  }

  private normalizeMobyScore(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 10) {
      return null;
    }

    return Math.round(value * 10) / 10;
  }

  private normalizeReviewSource(
    value: unknown,
    _score: unknown,
    url: unknown
  ): 'metacritic' | 'mobygames' | null {
    if (value === 'metacritic' || value === 'mobygames') {
      return value;
    }

    const normalizedUrl = this.normalizeExternalUrl(url);
    if (normalizedUrl !== null) {
      const detected = detectReviewSourceFromUrl(normalizedUrl);
      if (detected !== null) {
        return detected;
      }
    }

    return null;
  }

  private normalizePriceSource(value: unknown): GameEntry['priceSource'] {
    return value === 'steam_store' || value === 'psprices' ? value : null;
  }

  private normalizePriceFetchedAt(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : null;
  }

  private normalizePriceAmount(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return null;
    }
    return Math.round(value * 100) / 100;
  }

  private normalizePriceCurrency(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
  }

  private normalizePriceDiscountPercent(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      return null;
    }
    return Math.round(value * 100) / 100;
  }

  private normalizePriceIsFree(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  private normalizePriceUrl(value: unknown): string | null {
    return this.normalizeExternalUrl(value);
  }

  private normalizeGameType(value: unknown): GameEntry['gameType'] {
    return value === 'main_game' ||
      value === 'dlc_addon' ||
      value === 'expansion' ||
      value === 'bundle' ||
      value === 'standalone_expansion' ||
      value === 'mod' ||
      value === 'episode' ||
      value === 'season' ||
      value === 'remake' ||
      value === 'remaster' ||
      value === 'expanded_game' ||
      value === 'port' ||
      value === 'fork' ||
      value === 'pack' ||
      value === 'update'
      ? value
      : null;
  }

  private normalizeGameIdList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [
      ...new Set(
        value.map((entry) => String(entry ?? '').trim()).filter((entry) => /^\d+$/.test(entry))
      ),
    ];
  }

  private normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [
      ...new Set(
        value
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter((entry) => entry.length > 0)
      ),
    ];
  }

  private normalizeWebsites(value: unknown): GameWebsite[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const normalized: GameWebsite[] = [];
    const seen = new Set<string>();

    for (const entry of value) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const record = entry as Record<string, unknown>;
      const url =
        typeof record['url'] === 'string' ? sanitizeExternalHttpUrlString(record['url']) : null;
      if (url === null) {
        continue;
      }

      if (seen.has(url)) {
        continue;
      }

      seen.add(url);
      normalized.push({
        provider: this.normalizeWebsiteProvider(record['provider']),
        providerLabel: this.normalizeOptionalText(record['providerLabel']),
        url,
        typeId: this.parsePositiveInteger(record['typeId']),
        typeName: this.normalizeOptionalText(record['typeName']),
        trusted: this.normalizeOptionalBoolean(record['trusted']),
      });
    }

    return normalized;
  }

  private normalizeWebsiteProvider(value: unknown): GameWebsite['provider'] {
    return value === 'steam' ||
      value === 'playstation' ||
      value === 'xbox' ||
      value === 'nintendo' ||
      value === 'epic' ||
      value === 'gog' ||
      value === 'itch' ||
      value === 'apple' ||
      value === 'android' ||
      value === 'amazon' ||
      value === 'oculus' ||
      value === 'gamejolt' ||
      value === 'kartridge' ||
      value === 'utomik' ||
      value === 'unknown'
      ? value
      : null;
  }

  private normalizePositiveIntegerList(value: unknown): number[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [
      ...new Set(
        value
          .map((entry) => {
            if (typeof entry === 'number') {
              return Number.isInteger(entry) ? entry : Number.NaN;
            }

            if (typeof entry === 'string') {
              const trimmed = entry.trim();
              return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN;
            }

            return Number.NaN;
          })
          .filter((entry) => Number.isInteger(entry) && entry > 0)
      ),
    ];
  }

  private normalizeTagIds(value: unknown): number[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [
      ...new Set(
        value
          .map((entry) =>
            typeof entry === 'number'
              ? entry
              : typeof entry === 'string'
                ? Number.parseInt(entry, 10)
                : Number.NaN
          )
          .filter((entry) => Number.isInteger(entry) && entry > 0)
      ),
    ];
  }

  private normalizeReleaseDate(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeReleaseYear(value: unknown): number | null {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : Number.NaN;

    return Number.isInteger(parsed) && parsed >= 1950 && parsed <= 2100 ? parsed : null;
  }

  private normalizeStatus(value: unknown): GameEntry['status'] {
    return value === 'playing' ||
      value === 'wantToPlay' ||
      value === 'completed' ||
      value === 'paused' ||
      value === 'dropped' ||
      value === 'replay'
      ? value
      : null;
  }

  private normalizeRating(value: unknown): GameEntry['rating'] {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseFloat(value)
          : Number.NaN;

    return isGameRating(parsed) ? parsed : null;
  }

  private normalizeIsoTimestamp(value: unknown): string {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
      return value;
    }

    return new Date().toISOString();
  }

  private normalizeNotes(value: unknown): string | null {
    return this.htmlSanitizer.sanitizeNotesOrNull(value);
  }

  private async applyTagChange(
    change: SyncChangeEvent,
    identityCache?: Map<string, GameEntry>
  ): Promise<void> {
    if (change.operation === 'delete') {
      const payload = change.payload as { id?: unknown };
      const id = this.parsePositiveInteger(payload.id);

      if (id === null) {
        return;
      }

      await this.engine.deleteTag(id);

      const games = await this.engine.listAllGames();
      const now = new Date().toISOString();
      const gamesToUpdate: GameEntry[] = [];

      for (const game of games) {
        if (!Array.isArray(game.tagIds) || game.id === undefined) {
          continue;
        }

        const nextTagIds = game.tagIds.filter((tagId) => tagId !== id);

        if (nextTagIds.length === game.tagIds.length) {
          continue;
        }

        const updatedGame: GameEntry = {
          ...game,
          tagIds: nextTagIds,
          updatedAt: now,
        };
        gamesToUpdate.push(updatedGame);
        identityCache?.set(
          this.buildGameIdentityKey(updatedGame.igdbGameId, updatedGame.platformIgdbId),
          updatedGame
        );
      }

      if (gamesToUpdate.length > 0) {
        await this.engine.bulkPutGames(gamesToUpdate);
      }

      return;
    }

    const payload = change.payload as Partial<Tag>;
    const id = this.parsePositiveInteger(payload.id);

    if (id === null) {
      return;
    }

    const normalized: Tag = {
      id,
      name:
        typeof payload.name === 'string' && payload.name.trim().length > 0
          ? payload.name.trim()
          : `Tag ${String(id)}`,
      color:
        typeof payload.color === 'string' && payload.color.trim().length > 0
          ? payload.color.trim()
          : '#3880ff',
      createdAt:
        typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
      updatedAt:
        typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString(),
    };

    await this.engine.putTag(normalized);
  }

  private async applyViewChange(change: SyncChangeEvent): Promise<void> {
    if (change.operation === 'delete') {
      const payload = change.payload as { id?: unknown };
      const id = this.parsePositiveInteger(payload.id);

      if (id !== null) {
        await this.engine.deleteView(id);
      }
      return;
    }

    const payload = change.payload as Partial<GameListView>;
    const id = this.parsePositiveInteger(payload.id);
    const normalized: GameListView = {
      id: id ?? undefined,
      name:
        typeof payload.name === 'string' && payload.name.trim().length > 0
          ? payload.name.trim()
          : 'Saved View',
      listType: payload.listType === 'wishlist' ? 'wishlist' : 'collection',
      filters: payload.filters ?? { ...DEFAULT_GAME_LIST_FILTERS },
      groupBy: payload.groupBy ?? 'none',
      createdAt:
        typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
      updatedAt:
        typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString(),
    };

    await this.engine.putView(normalized);
  }

  private applySettingChange(change: SyncChangeEvent): void {
    if (change.operation === 'delete') {
      const payload = change.payload as { key?: unknown };
      const key = typeof payload.key === 'string' ? payload.key.trim() : '';

      if (key.length === 0) {
        return;
      }

      try {
        this.preferenceStorage.removeItem(key);
      } catch {
        // Ignore storage failures.
      }

      if (key === PLATFORM_ORDER_STORAGE_KEY) {
        this.platformOrderService.refreshFromStorage();
      }

      if (key === PLATFORM_DISPLAY_NAMES_STORAGE_KEY) {
        this.platformCustomizationService.refreshFromStorage();
      }
      return;
    }

    const payload = change.payload as { key?: unknown; value?: unknown };
    const key = typeof payload.key === 'string' ? payload.key.trim() : '';
    const value = typeof payload.value === 'string' ? payload.value : '';

    if (key.length === 0) {
      return;
    }

    try {
      this.preferenceStorage.setItem(key, value);
    } catch {
      // Ignore storage failures.
    }

    if (key === PLATFORM_ORDER_STORAGE_KEY) {
      this.platformOrderService.refreshFromStorage();
    }

    if (key === PLATFORM_DISPLAY_NAMES_STORAGE_KEY) {
      this.platformCustomizationService.refreshFromStorage();
    }
  }

  private async getMeta(key: string): Promise<string | null> {
    const entry = await this.engine.getSyncMeta(key);
    return entry?.value ?? null;
  }

  private async hasPendingGameOutboxOperation(
    igdbGameId: string,
    platformIgdbId: number,
    pendingGameOutboxKeys?: ReadonlySet<string>
  ): Promise<boolean> {
    if (pendingGameOutboxKeys) {
      return pendingGameOutboxKeys.has(this.buildGameIdentityKey(igdbGameId, platformIgdbId));
    }

    const pendingGameOutboxKeysNow = await this.loadPendingGameOutboxKeys();
    return pendingGameOutboxKeysNow.has(this.buildGameIdentityKey(igdbGameId, platformIgdbId));
  }

  private async loadPendingGameOutboxKeys(): Promise<Set<string>> {
    const pendingGameOps = await this.engine.listOutboxByEntityType('game');
    const keys = new Set<string>();

    pendingGameOps.forEach((entry) => {
      const payload =
        entry.payload && typeof entry.payload === 'object'
          ? (entry.payload as Record<string, unknown>)
          : null;
      if (!payload) {
        return;
      }

      const payloadGameId =
        typeof payload['igdbGameId'] === 'string' ? payload['igdbGameId'].trim() : '';
      const payloadPlatformId = this.parsePositiveInteger(payload['platformIgdbId']);

      if (payloadGameId.length === 0 || payloadPlatformId === null) {
        return;
      }

      keys.add(this.buildGameIdentityKey(payloadGameId, payloadPlatformId));
    });

    return keys;
  }

  private buildGameIdentityKey(igdbGameId: string, platformIgdbId: number): string {
    return `${igdbGameId}::${String(platformIgdbId)}`;
  }

  private async setMeta(key: string, value: string): Promise<void> {
    const entry: SyncMetaEntry = {
      key,
      value,
      updatedAt: new Date().toISOString(),
    };

    await this.engine.putSyncMeta(entry);
  }

  private async runDiscoveryPollutionRemediationIfNeeded(): Promise<void> {
    const marker = await this.getMeta(DISCOVERY_POLLUTION_REMEDIATION_META_KEY);

    if (marker === 'done') {
      return;
    }

    if ((await this.engine.countGames()) === 0) {
      await this.setMeta(DISCOVERY_POLLUTION_REMEDIATION_META_KEY, 'done');
      this.debugLogService.info('sync.discovery_pollution_remediation_skipped_fresh_install');
      return;
    }

    const now = new Date().toISOString();
    await this.engine.runInTransaction(['syncMeta'], async () => {
      await this.engine.putSyncMeta({
        key: GameSyncService.META_CURSOR_KEY,
        value: '0',
        updatedAt: now,
      });
      await this.engine.putSyncMeta({
        key: DISCOVERY_POLLUTION_REMEDIATION_META_KEY,
        value: 'done',
        updatedAt: now,
      });
    });
    this.debugLogService.info('sync.discovery_pollution_remediation_applied');
  }

  private async requestPersistentStorage(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined') {
        await navigator.storage.persist();
      }
    } catch {
      // Ignore storage persistence request failures.
    }
  }

  private isOnline(): boolean {
    return this.networkConnectivity.isConnected();
  }

  private isApiReachable(): boolean {
    return this.runtimeAvailability.status() === 'online';
  }

  private normalizeBaseUrl(value: string | null | undefined): string {
    const normalized = (value ?? '').trim();
    return normalized.replace(/\/+$/, '');
  }

  private normalizePulledGamePayload(
    payload: Partial<GameEntry>,
    pulledListType: string,
    context: PulledGameNormalizeContext
  ): GameEntry {
    const { existingByIdentity, hasPendingLocalWrite, serverId, serverIdCanBeReused } = context;
    const igdbGameId = typeof payload.igdbGameId === 'string' ? payload.igdbGameId.trim() : '';
    const platformIgdbId = this.parsePositiveInteger(payload.platformIgdbId) ?? 0;
    const title =
      typeof payload.title === 'string' && payload.title.trim().length > 0
        ? payload.title.trim()
        : 'Unknown title';
    const platform =
      typeof payload.platform === 'string' && payload.platform.trim().length > 0
        ? payload.platform.trim()
        : 'Unknown platform';
    const normalizedListType = pulledListType === 'wishlist' ? 'wishlist' : 'collection';
    const createdAt = this.normalizeIsoTimestamp(payload.createdAt);
    const updatedAt = this.normalizeIsoTimestamp(payload.updatedAt);
    let enteredCollectionAt: string | null = null;

    if (payload.enteredCollectionAt !== undefined) {
      enteredCollectionAt = this.normalizeNullableIsoTimestamp(payload.enteredCollectionAt);
    } else if (normalizedListType === 'wishlist') {
      enteredCollectionAt = null;
    } else if (existingByIdentity?.enteredCollectionAt != null) {
      enteredCollectionAt = existingByIdentity.enteredCollectionAt;
    } else {
      enteredCollectionAt = existingByIdentity?.createdAt ?? createdAt;
    }
    const normalizedReviewScore = this.normalizeReviewScore(
      payload.reviewScore ?? payload.metacriticScore
    );
    const normalizedReviewUrl = this.normalizeExternalUrl(
      payload.reviewUrl ?? payload.metacriticUrl
    );
    const normalizedReviewSource = this.normalizeReviewSource(
      payload.reviewSource,
      normalizedReviewScore,
      normalizedReviewUrl
    );
    const mobyScoreRaw = this.normalizeMobyScore(payload.mobyScore);
    // If source is MobyGames, convert reviewScore from 0–10 to 0–100 when needed.
    // Use mobyScore as ground truth (it is always on the 0–10 scale) when available:
    // if reviewScore matches mobyScore, it arrived on the 0–10 scale and must be
    // scaled up. Fall back to the ≤10 heuristic when mobyScore is absent.
    const effectiveReviewScore =
      normalizedReviewSource === 'mobygames' &&
      normalizedReviewScore !== null &&
      (mobyScoreRaw !== null ? normalizedReviewScore === mobyScoreRaw : normalizedReviewScore <= 10)
        ? this.normalizeReviewScore(normalizedReviewScore * 10)
        : normalizedReviewScore;
    const explicitMetacriticScore = this.normalizeMetacriticScore(payload.metacriticScore);
    const explicitMetacriticUrl = this.normalizeExternalUrl(payload.metacriticUrl);
    const normalizedMetacriticScore =
      normalizedReviewSource === 'metacritic'
        ? (explicitMetacriticScore ?? normalizedReviewScore)
        : explicitMetacriticScore;
    const normalizedMetacriticUrl =
      normalizedReviewSource === 'metacritic'
        ? (explicitMetacriticUrl ?? normalizedReviewUrl)
        : explicitMetacriticUrl;
    const incomingCoverUrl = this.normalizeExternalUrl(payload.coverUrl);
    const incomingCustomCoverUrl = this.normalizeCustomCoverUrl(payload.customCoverUrl);
    const incomingCoverSource =
      payload.coverSource === 'thegamesdb' ||
      payload.coverSource === 'igdb' ||
      payload.coverSource === 'none'
        ? payload.coverSource
        : 'none';
    const coverUrl = hasPendingLocalWrite
      ? existingByIdentity
        ? existingByIdentity.coverUrl
        : incomingCoverUrl
      : incomingCoverUrl;
    const customCoverUrl = hasPendingLocalWrite
      ? existingByIdentity
        ? existingByIdentity.customCoverUrl
        : incomingCustomCoverUrl
      : incomingCustomCoverUrl;
    const coverSource = hasPendingLocalWrite
      ? existingByIdentity
        ? existingByIdentity.coverSource
        : incomingCoverSource
      : incomingCoverSource;

    const normalized: GameEntry = {
      id:
        existingByIdentity?.id ?? (serverIdCanBeReused && serverId !== null ? serverId : undefined),
      igdbGameId,
      platformIgdbId,
      title,
      customTitle: this.normalizeCustomTitle(payload.customTitle, title),
      coverUrl,
      customCoverUrl,
      coverSource,
      storyline: this.normalizeOptionalText(payload.storyline),
      summary: this.normalizeOptionalText(payload.summary),
      gameType: this.normalizeGameType(payload.gameType),
      hltbMainHours: this.normalizeCompletionHours(payload.hltbMainHours),
      hltbMainExtraHours: this.normalizeCompletionHours(payload.hltbMainExtraHours),
      hltbCompletionistHours: this.normalizeCompletionHours(payload.hltbCompletionistHours),
      hltbMatchGameId:
        payload.hltbMatchGameId === undefined
          ? this.parsePositiveInteger(existingByIdentity?.hltbMatchGameId)
          : this.parsePositiveInteger(payload.hltbMatchGameId),
      hltbMatchUrl:
        payload.hltbMatchUrl === undefined
          ? this.normalizeExternalUrl(existingByIdentity?.hltbMatchUrl)
          : this.normalizeExternalUrl(payload.hltbMatchUrl),
      hltbMatchQueryTitle:
        payload.hltbMatchQueryTitle === undefined
          ? this.normalizeOptionalText(existingByIdentity?.hltbMatchQueryTitle)
          : this.normalizeOptionalText(payload.hltbMatchQueryTitle),
      hltbMatchQueryReleaseYear:
        payload.hltbMatchQueryReleaseYear === undefined
          ? this.parsePositiveInteger(existingByIdentity?.hltbMatchQueryReleaseYear)
          : this.parsePositiveInteger(payload.hltbMatchQueryReleaseYear),
      hltbMatchQueryPlatform:
        payload.hltbMatchQueryPlatform === undefined
          ? this.normalizeOptionalText(existingByIdentity?.hltbMatchQueryPlatform)
          : this.normalizeOptionalText(payload.hltbMatchQueryPlatform),
      hltbMatchLocked:
        payload.hltbMatchLocked === undefined
          ? this.normalizeOptionalBoolean(existingByIdentity?.hltbMatchLocked)
          : this.normalizeOptionalBoolean(payload.hltbMatchLocked),
      reviewScore: effectiveReviewScore,
      reviewUrl: normalizedReviewUrl,
      reviewSource: normalizedReviewSource,
      mobyScore: mobyScoreRaw,
      mobygamesGameId: this.parsePositiveInteger(payload.mobygamesGameId),
      reviewMatchQueryTitle:
        payload.reviewMatchQueryTitle === undefined
          ? this.normalizeOptionalText(existingByIdentity?.reviewMatchQueryTitle)
          : this.normalizeOptionalText(payload.reviewMatchQueryTitle),
      reviewMatchQueryReleaseYear:
        payload.reviewMatchQueryReleaseYear === undefined
          ? this.parsePositiveInteger(existingByIdentity?.reviewMatchQueryReleaseYear)
          : this.parsePositiveInteger(payload.reviewMatchQueryReleaseYear),
      reviewMatchQueryPlatform:
        payload.reviewMatchQueryPlatform === undefined
          ? this.normalizeOptionalText(existingByIdentity?.reviewMatchQueryPlatform)
          : this.normalizeOptionalText(payload.reviewMatchQueryPlatform),
      reviewMatchPlatformIgdbId:
        payload.reviewMatchPlatformIgdbId === undefined
          ? this.parsePositiveInteger(existingByIdentity?.reviewMatchPlatformIgdbId)
          : this.parsePositiveInteger(payload.reviewMatchPlatformIgdbId),
      reviewMatchMobygamesGameId:
        payload.reviewMatchMobygamesGameId === undefined
          ? this.parsePositiveInteger(existingByIdentity?.reviewMatchMobygamesGameId)
          : this.parsePositiveInteger(payload.reviewMatchMobygamesGameId),
      reviewMatchLocked:
        payload.reviewMatchLocked === undefined
          ? this.normalizeOptionalBoolean(existingByIdentity?.reviewMatchLocked)
          : this.normalizeOptionalBoolean(payload.reviewMatchLocked),
      metacriticScore: normalizedMetacriticScore,
      metacriticUrl: normalizedMetacriticUrl,
      similarGameIgdbIds: this.normalizeGameIdList(payload.similarGameIgdbIds),
      collections: this.normalizeStringList(payload.collections),
      developers: this.normalizeStringList(payload.developers),
      franchises: this.normalizeStringList(payload.franchises),
      genres: this.normalizeStringList(payload.genres),
      themes:
        payload.themes === undefined
          ? this.normalizeStringList(existingByIdentity?.themes)
          : this.normalizeStringList(payload.themes),
      themeIds:
        payload.themeIds === undefined
          ? this.normalizePositiveIntegerList(existingByIdentity?.themeIds)
          : this.normalizePositiveIntegerList(payload.themeIds),
      keywords:
        payload.keywords === undefined
          ? this.normalizeStringList(existingByIdentity?.keywords)
          : this.normalizeStringList(payload.keywords),
      keywordIds:
        payload.keywordIds === undefined
          ? this.normalizePositiveIntegerList(existingByIdentity?.keywordIds)
          : this.normalizePositiveIntegerList(payload.keywordIds),
      websites:
        payload.websites === undefined
          ? this.normalizeWebsites(existingByIdentity?.websites)
          : this.normalizeWebsites(payload.websites),
      steamAppId:
        payload.steamAppId === undefined
          ? this.parsePositiveInteger(existingByIdentity?.steamAppId)
          : this.parsePositiveInteger(payload.steamAppId),
      priceSource:
        payload.priceSource === undefined
          ? this.normalizePriceSource(existingByIdentity?.priceSource)
          : this.normalizePriceSource(payload.priceSource),
      priceFetchedAt:
        payload.priceFetchedAt === undefined
          ? this.normalizePriceFetchedAt(existingByIdentity?.priceFetchedAt)
          : this.normalizePriceFetchedAt(payload.priceFetchedAt),
      priceAmount:
        payload.priceAmount === undefined
          ? this.normalizePriceAmount(existingByIdentity?.priceAmount)
          : this.normalizePriceAmount(payload.priceAmount),
      priceCurrency:
        payload.priceCurrency === undefined
          ? this.normalizePriceCurrency(existingByIdentity?.priceCurrency)
          : this.normalizePriceCurrency(payload.priceCurrency),
      priceRegularAmount:
        payload.priceRegularAmount === undefined
          ? this.normalizePriceAmount(existingByIdentity?.priceRegularAmount)
          : this.normalizePriceAmount(payload.priceRegularAmount),
      priceDiscountPercent:
        payload.priceDiscountPercent === undefined
          ? this.normalizePriceDiscountPercent(existingByIdentity?.priceDiscountPercent)
          : this.normalizePriceDiscountPercent(payload.priceDiscountPercent),
      priceIsFree:
        payload.priceIsFree === undefined
          ? this.normalizePriceIsFree(existingByIdentity?.priceIsFree)
          : this.normalizePriceIsFree(payload.priceIsFree),
      priceUrl:
        payload.priceUrl === undefined
          ? this.normalizePriceUrl(existingByIdentity?.priceUrl)
          : this.normalizePriceUrl(payload.priceUrl),
      psPricesMatchLocked:
        payload.psPricesMatchLocked === undefined
          ? this.normalizeOptionalBoolean(existingByIdentity?.psPricesMatchLocked)
          : this.normalizeOptionalBoolean(payload.psPricesMatchLocked),
      screenshots:
        payload.screenshots === undefined
          ? normalizeGameScreenshots(existingByIdentity?.screenshots, { maxItems: 20 })
          : normalizeGameScreenshots(payload.screenshots, { maxItems: 20 }),
      videos:
        payload.videos === undefined
          ? normalizeGameVideos(existingByIdentity?.videos, { maxItems: 5 })
          : normalizeGameVideos(payload.videos, { maxItems: 5 }),
      publishers: this.normalizeStringList(payload.publishers),
      platform,
      customPlatform: this.normalizeCustomPlatform(
        payload.customPlatform,
        payload.customPlatformIgdbId,
        payload.platform
      ),
      customPlatformIgdbId: this.normalizeCustomPlatformIgdbId(
        payload.customPlatformIgdbId,
        payload.customPlatform,
        payload.platformIgdbId,
        payload.platform
      ),
      tagIds: this.normalizeTagIds(payload.tagIds),
      releaseDate: this.normalizeReleaseDate(payload.releaseDate),
      releaseYear: this.normalizeReleaseYear(payload.releaseYear),
      status: this.normalizeStatus(payload.status),
      rating: this.normalizeRating(payload.rating),
      listType: normalizedListType,
      enteredCollectionAt,
      notes: this.normalizeNotes(payload.notes),
      createdAt,
      updatedAt,
    };

    return normalized;
  }

  private async beginInitialLoadProgressIfNeeded(): Promise<void> {
    if (this.syncBootstrapProgress.progress().active) {
      return;
    }

    if (await this.isInitialLibraryLoadPending()) {
      this.syncBootstrapProgress.start();
    }
  }

  private async isInitialLibraryLoadPending(): Promise<boolean> {
    const bootstrapMarker = await this.getMeta(GameSyncService.META_BOOTSTRAP_KEY);

    if (bootstrapMarker === 'done') {
      return false;
    }

    if ((await this.engine.countOutbox()) > 0) {
      return false;
    }

    return true;
  }

  private async shouldTrackInitialLoadProgress(): Promise<boolean> {
    if (this.syncBootstrapProgress.progress().active) {
      return true;
    }

    return this.isInitialLibraryLoadPending();
  }

  private async completeInitialLibraryLoadIfPending(): Promise<void> {
    if (!(await this.isInitialLibraryLoadPending())) {
      return;
    }

    await this.setMeta(GameSyncService.META_BOOTSTRAP_KEY, 'done');
    this.syncEvents.emitChanged();
  }

  private generateOperationId(): string {
    return generateOperationId();
  }
}
