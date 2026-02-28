import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AppDb, OutboxEntry, SyncMetaEntry } from '../data/app-db';
import { SyncOutboxWriteRequest, SyncOutboxWriter } from '../data/sync-outbox-writer';
import {
  ClientSyncOperation,
  DEFAULT_GAME_LIST_FILTERS,
  GameEntry,
  GameListView,
  SyncChangeEvent,
  SyncPushResult,
  Tag
} from '../models/game.models';
import { environment } from '../../../environments/environment';
import { SyncEventsService } from './sync-events.service';
import { PlatformOrderService, PLATFORM_ORDER_STORAGE_KEY } from './platform-order.service';
import {
  PlatformCustomizationService,
  PLATFORM_DISPLAY_NAMES_STORAGE_KEY
} from './platform-customization.service';
import { HtmlSanitizerService } from '../security/html-sanitizer.service';
import { DebugLogService } from './debug-log.service';
import { normalizeHttpError } from '../utils/normalize-http-error';
import { detectReviewSourceFromUrl } from '../utils/url-host.util';

interface SyncPushResponse {
  results: SyncPushResult[];
  cursor: string;
}

interface SyncPullResponse {
  cursor: string;
  changes: SyncChangeEvent[];
}

@Injectable({ providedIn: 'root' })
export class GameSyncService implements SyncOutboxWriter {
  private static readonly SYNC_INTERVAL_MS = 30_000;
  private static readonly MAX_PUSH_BODY_BYTES = 8 * 1024 * 1024;
  private static readonly PUSH_BODY_PREFIX_BYTES = '{"operations":['.length;
  private static readonly PUSH_BODY_SUFFIX_BYTES = ']}'.length;
  private static readonly META_CURSOR_KEY = 'cursor';
  private static readonly META_LAST_SYNC_KEY = 'lastSyncAt';
  private static readonly META_CONNECTIVITY_KEY = 'connectivity';

  private readonly db = inject(AppDb);
  private readonly httpClient = inject(HttpClient);
  private readonly syncEvents = inject(SyncEventsService);
  private readonly platformOrderService = inject(PlatformOrderService);
  private readonly platformCustomizationService = inject(PlatformCustomizationService);
  private readonly htmlSanitizer = inject(HtmlSanitizerService);
  private readonly debugLogService = inject(DebugLogService);
  private readonly baseUrl = this.normalizeBaseUrl(environment.gameApiBaseUrl);
  private initialized = false;
  private syncInFlight = false;
  private intervalId: number | null = null;
  private readonly onlineHandler = () => {
    void this.setMeta(GameSyncService.META_CONNECTIVITY_KEY, 'online');
    void this.syncNow();
  };
  private readonly offlineHandler = () => {
    void this.setMeta(GameSyncService.META_CONNECTIVITY_KEY, 'offline');
  };

  initialize(): void {
    if (this.initialized) {
      this.debugLogService.debug('sync.initialize.skipped_already_initialized');
      return;
    }

    this.initialized = true;
    this.debugLogService.debug('sync.initialize.start', {
      baseUrl: this.baseUrl,
      online: this.isOnline()
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onlineHandler);
      window.addEventListener('offline', this.offlineHandler);
      this.intervalId = window.setInterval(() => {
        void this.syncNow();
      }, GameSyncService.SYNC_INTERVAL_MS);
    }

    void this.requestPersistentStorage();
    void this.setMeta(
      GameSyncService.META_CONNECTIVITY_KEY,
      this.isOnline() ? 'online' : 'offline'
    );
    void this.syncNow();
  }

  async enqueueOperation(request: SyncOutboxWriteRequest): Promise<void> {
    const now = new Date().toISOString();
    const entry: OutboxEntry = {
      opId:
        typeof request.opId === 'string' && request.opId.trim().length > 0
          ? request.opId.trim()
          : this.generateOperationId(),
      entityType: request.entityType,
      operation: request.operation,
      payload: request.payload,
      clientTimestamp: request.clientTimestamp ?? now,
      createdAt: now,
      attemptCount: 0,
      lastError: null
    };

    await this.db.outbox.put(entry);
    this.debugLogService.debug('sync.outbox.enqueued', {
      opId: entry.opId,
      entityType: entry.entityType,
      operation: entry.operation
    });
    void this.syncNow();
  }

  async syncNow(): Promise<void> {
    if (!this.baseUrl) {
      this.debugLogService.warn('sync.sync_now.skipped_missing_base_url');
      return;
    }

    if (this.syncInFlight) {
      this.debugLogService.debug('sync.sync_now.skipped_in_flight');
      return;
    }

    if (!this.isOnline()) {
      this.debugLogService.debug('sync.sync_now.skipped_offline');
      return;
    }

    this.debugLogService.debug('sync.sync_now.start');
    this.syncInFlight = true;

    try {
      await this.pushOutbox();
      await this.pullChanges();
      await this.setMeta(GameSyncService.META_LAST_SYNC_KEY, new Date().toISOString());
      await this.setMeta(GameSyncService.META_CONNECTIVITY_KEY, 'online');
      this.debugLogService.debug('sync.sync_now.success');
    } catch (error: unknown) {
      await this.setMeta(GameSyncService.META_CONNECTIVITY_KEY, 'degraded');
      this.debugLogService.error('sync.sync_now.failed', {
        error: normalizeHttpError(error)
      });
    } finally {
      this.syncInFlight = false;
    }
  }

  private async pushOutbox(): Promise<void> {
    const entries = await this.db.outbox.orderBy('createdAt').toArray();

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
      clientTimestamp: entry.clientTimestamp
    }));
    const operationBatches = this.buildPushOperationBatches(
      operations,
      GameSyncService.MAX_PUSH_BODY_BYTES
    );
    const ackedIds = new Set<string>();
    const failedResults: SyncPushResult[] = [];
    let latestCursor: string | null = null;

    for (const batch of operationBatches) {
      this.debugLogService.debug('sync.push.batch.request', { batchSize: batch.length });
      const response = await firstValueFrom(
        this.httpClient.post<SyncPushResponse>(`${this.baseUrl}/v1/sync/push`, {
          operations: batch
        })
      );
      this.debugLogService.debug('sync.push.batch.response', {
        batchSize: batch.length,
        results: Array.isArray(response.results) ? response.results.length : 0,
        hasCursor: typeof response.cursor === 'string' && response.cursor.trim().length > 0
      });

      if (typeof response.cursor === 'string' && response.cursor.trim().length > 0) {
        latestCursor = response.cursor.trim();
      }

      const batchResults = Array.isArray(response.results) ? response.results : [];

      batchResults
        .filter((result) => result.status === 'applied' || result.status === 'duplicate')
        .map((result) => result.opId)
        .filter((opId) => typeof opId === 'string' && opId.trim().length > 0)
        .forEach((opId) => ackedIds.add(opId));

      failedResults.push(...batchResults.filter((result) => result.status === 'failed'));
    }

    if (latestCursor) {
      await this.setMeta(GameSyncService.META_CURSOR_KEY, latestCursor);
    }

    if (ackedIds.size > 0) {
      await this.db.outbox.bulkDelete([...ackedIds]);
    }
    this.debugLogService.debug('sync.push.complete', {
      acked: ackedIds.size,
      failed: failedResults.length
    });

    for (const failure of failedResults) {
      const existing = await this.db.outbox.get(failure.opId);

      if (!existing) {
        continue;
      }

      await this.db.outbox.put({
        ...existing,
        attemptCount: existing.attemptCount + 1,
        lastError: failure.message ?? 'Failed to push operation.'
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
    const cursor = await this.getMeta(GameSyncService.META_CURSOR_KEY);
    this.debugLogService.debug('sync.pull.request', { hasCursor: Boolean(cursor) });
    const response = await firstValueFrom(
      this.httpClient.post<SyncPullResponse>(`${this.baseUrl}/v1/sync/pull`, {
        cursor: cursor ?? null
      })
    );
    const changes = Array.isArray(response.changes) ? response.changes : [];
    this.debugLogService.debug('sync.pull.response', {
      changes: changes.length,
      hasCursor: typeof response.cursor === 'string' && response.cursor.trim().length > 0
    });

    if (changes.length === 0) {
      if (typeof response.cursor === 'string' && response.cursor.trim().length > 0) {
        await this.setMeta(GameSyncService.META_CURSOR_KEY, response.cursor.trim());
      }
      return;
    }

    await this.applyPulledChanges(changes);

    const nextCursor =
      typeof response.cursor === 'string' && response.cursor.trim().length > 0
        ? response.cursor.trim()
        : changes[changes.length - 1].eventId;
    await this.setMeta(GameSyncService.META_CURSOR_KEY, nextCursor);
    this.syncEvents.emitChanged();
    this.debugLogService.debug('sync.pull.applied', { changes: changes.length });
  }

  private async applyPulledChanges(changes: SyncChangeEvent[]): Promise<void> {
    await this.db.transaction('rw', this.db.games, this.db.tags, this.db.views, async () => {
      for (const change of changes) {
        if (change.entityType === 'game') {
          await this.applyGameChange(change);
          continue;
        }

        if (change.entityType === 'tag') {
          await this.applyTagChange(change);
          continue;
        }

        if (change.entityType === 'view') {
          await this.applyViewChange(change);
          continue;
        }

        this.applySettingChange(change);
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

  private async applyGameChange(change: SyncChangeEvent): Promise<void> {
    if (change.operation === 'delete') {
      const payload = change.payload as { igdbGameId?: unknown; platformIgdbId?: unknown };
      const igdbGameId = typeof payload.igdbGameId === 'string' ? payload.igdbGameId.trim() : '';
      const platformIgdbId = this.parsePositiveInteger(payload.platformIgdbId);

      if (!igdbGameId || platformIgdbId === null) {
        return;
      }

      const existing = await this.db.games
        .where('[igdbGameId+platformIgdbId]')
        .equals([igdbGameId, platformIgdbId])
        .first();

      if (existing?.id !== undefined) {
        await this.db.games.delete(existing.id);
      }
      return;
    }

    const payload = change.payload as Partial<GameEntry>;
    const igdbGameId = typeof payload.igdbGameId === 'string' ? payload.igdbGameId.trim() : '';
    const platformIgdbId = this.parsePositiveInteger(payload.platformIgdbId);

    if (!igdbGameId || platformIgdbId === null) {
      return;
    }

    const title =
      typeof payload.title === 'string' && payload.title.trim().length > 0
        ? payload.title.trim()
        : 'Unknown title';
    const platform =
      typeof payload.platform === 'string' && payload.platform.trim().length > 0
        ? payload.platform.trim()
        : 'Unknown platform';
    const createdAt = this.normalizeIsoTimestamp(payload.createdAt);
    const updatedAt = this.normalizeIsoTimestamp(payload.updatedAt);
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
    const normalized: GameEntry = {
      id: this.parsePositiveInteger(payload.id) ?? undefined,
      igdbGameId,
      platformIgdbId,
      title,
      customTitle: this.normalizeCustomTitle(payload.customTitle, title),
      coverUrl: this.normalizeExternalUrl(payload.coverUrl),
      customCoverUrl: this.normalizeCustomCoverUrl(payload.customCoverUrl),
      coverSource:
        payload.coverSource === 'thegamesdb' ||
        payload.coverSource === 'igdb' ||
        payload.coverSource === 'none'
          ? payload.coverSource
          : 'none',
      storyline: this.normalizeOptionalText(payload.storyline),
      summary: this.normalizeOptionalText(payload.summary),
      gameType: this.normalizeGameType(payload.gameType),
      hltbMainHours: this.normalizeCompletionHours(payload.hltbMainHours),
      hltbMainExtraHours: this.normalizeCompletionHours(payload.hltbMainExtraHours),
      hltbCompletionistHours: this.normalizeCompletionHours(payload.hltbCompletionistHours),
      reviewScore: normalizedReviewScore,
      reviewUrl: normalizedReviewUrl,
      reviewSource: normalizedReviewSource,
      mobyScore: this.normalizeMobyScore(payload.mobyScore),
      mobygamesGameId: this.parsePositiveInteger(payload.mobygamesGameId),
      metacriticScore: normalizedMetacriticScore,
      metacriticUrl: normalizedMetacriticUrl,
      similarGameIgdbIds: this.normalizeGameIdList(payload.similarGameIgdbIds),
      collections: this.normalizeStringList(payload.collections),
      developers: this.normalizeStringList(payload.developers),
      franchises: this.normalizeStringList(payload.franchises),
      genres: this.normalizeStringList(payload.genres),
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
      listType: payload.listType === 'wishlist' ? 'wishlist' : 'collection',
      notes: this.normalizeNotes(payload.notes),
      createdAt,
      updatedAt
    };

    await this.db.games.put(normalized);
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

    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized) ? normalized : null;
  }

  private normalizeOptionalText(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : null;
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
      )
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
      )
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
      )
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
          ? Number.parseInt(value, 10)
          : Number.NaN;

    return parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 || parsed === 5
      ? parsed
      : null;
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

  private async applyTagChange(change: SyncChangeEvent): Promise<void> {
    if (change.operation === 'delete') {
      const payload = change.payload as { id?: unknown };
      const id = this.parsePositiveInteger(payload.id);

      if (id === null) {
        return;
      }

      await this.db.tags.delete(id);

      const games = await this.db.games.toArray();
      const now = new Date().toISOString();

      for (const game of games) {
        if (!Array.isArray(game.tagIds) || game.id === undefined) {
          continue;
        }

        const nextTagIds = game.tagIds.filter((tagId) => tagId !== id);

        if (nextTagIds.length === game.tagIds.length) {
          continue;
        }

        await this.db.games.update(game.id, {
          tagIds: nextTagIds,
          updatedAt: now
        });
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
        typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString()
    };

    await this.db.tags.put(normalized);
  }

  private async applyViewChange(change: SyncChangeEvent): Promise<void> {
    if (change.operation === 'delete') {
      const payload = change.payload as { id?: unknown };
      const id = this.parsePositiveInteger(payload.id);

      if (id !== null) {
        await this.db.views.delete(id);
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
        typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString()
    };

    await this.db.views.put(normalized);
  }

  private applySettingChange(change: SyncChangeEvent): void {
    if (change.operation === 'delete') {
      const payload = change.payload as { key?: unknown };
      const key = typeof payload.key === 'string' ? payload.key.trim() : '';

      if (key.length === 0) {
        return;
      }

      try {
        localStorage.removeItem(key);
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
      localStorage.setItem(key, value);
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
    const entry = await this.db.syncMeta.get(key);
    return entry?.value ?? null;
  }

  private async setMeta(key: string, value: string): Promise<void> {
    const entry: SyncMetaEntry = {
      key,
      value,
      updatedAt: new Date().toISOString()
    };

    await this.db.syncMeta.put(entry);
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
    if (typeof navigator === 'undefined') {
      return true;
    }

    return navigator.onLine;
  }

  private normalizeBaseUrl(value: string | null | undefined): string {
    const normalized = (value ?? '').trim();
    return normalized.replace(/\/+$/, '');
  }

  private generateOperationId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
