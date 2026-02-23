import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AppDb, OutboxEntry, SyncMetaEntry } from '../data/app-db';
import { SyncOutboxWriteRequest, SyncOutboxWriter } from '../data/sync-outbox-writer';
import {
  ClientSyncOperation,
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
      return;
    }

    this.initialized = true;

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
    void this.syncNow();
  }

  async syncNow(): Promise<void> {
    if (!this.baseUrl || this.syncInFlight || !this.isOnline()) {
      return;
    }

    this.syncInFlight = true;

    try {
      await this.pushOutbox();
      await this.pullChanges();
      await this.setMeta(GameSyncService.META_LAST_SYNC_KEY, new Date().toISOString());
      await this.setMeta(GameSyncService.META_CONNECTIVITY_KEY, 'online');
    } catch {
      await this.setMeta(GameSyncService.META_CONNECTIVITY_KEY, 'degraded');
    } finally {
      this.syncInFlight = false;
    }
  }

  private async pushOutbox(): Promise<void> {
    const entries = await this.db.outbox.orderBy('createdAt').toArray();

    if (entries.length === 0) {
      return;
    }

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
      const response = await firstValueFrom(
        this.httpClient.post<SyncPushResponse>(`${this.baseUrl}/v1/sync/push`, {
          operations: batch
        })
      );

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
    const response = await firstValueFrom(
      this.httpClient.post<SyncPullResponse>(`${this.baseUrl}/v1/sync/pull`, {
        cursor: cursor ?? null
      })
    );
    const changes = Array.isArray(response.changes) ? response.changes : [];

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

        if (change.entityType === 'setting') {
          await this.applySettingChange(change);
          continue;
        }
      }
    });
  }

  private async applyGameChange(change: SyncChangeEvent): Promise<void> {
    if (change.operation === 'delete') {
      const payload = change.payload as { igdbGameId?: unknown; platformIgdbId?: unknown };
      const igdbGameId = typeof payload?.igdbGameId === 'string' ? payload.igdbGameId.trim() : '';
      const platformIgdbId = Number.parseInt(String(payload?.platformIgdbId ?? ''), 10);

      if (!igdbGameId || !Number.isInteger(platformIgdbId) || platformIgdbId <= 0) {
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
    const igdbGameId = typeof payload?.igdbGameId === 'string' ? payload.igdbGameId.trim() : '';
    const platformIgdbId = Number.parseInt(String(payload?.platformIgdbId ?? ''), 10);

    if (!igdbGameId || !Number.isInteger(platformIgdbId) || platformIgdbId <= 0) {
      return;
    }

    const normalized = {
      ...payload,
      igdbGameId,
      platformIgdbId,
      title:
        typeof payload.title === 'string' && payload.title.trim().length > 0
          ? payload.title.trim()
          : 'Unknown title',
      customTitle: this.normalizeCustomTitle(
        payload.customTitle,
        typeof payload.title === 'string' ? payload.title : ''
      ),
      platform:
        typeof payload.platform === 'string' && payload.platform.trim().length > 0
          ? payload.platform.trim()
          : 'Unknown platform',
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
      customCoverUrl: this.normalizeCustomCoverUrl(payload.customCoverUrl),
      listType: payload.listType === 'wishlist' ? 'wishlist' : 'collection',
      createdAt:
        typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
      updatedAt:
        typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString(),
      coverSource:
        payload.coverSource === 'thegamesdb' ||
        payload.coverSource === 'igdb' ||
        payload.coverSource === 'none'
          ? payload.coverSource
          : 'none',
      tagIds: Array.isArray(payload.tagIds)
        ? [...new Set(payload.tagIds.filter((value) => Number.isInteger(value) && value > 0))]
        : []
    } as GameEntry;

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
    const parsed = Number.parseInt(String(value ?? ''), 10);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }

    return parsed;
  }

  private normalizeCustomCoverUrl(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (normalized.length === 0) {
      return null;
    }

    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized) ? normalized : null;
  }

  private async applyTagChange(change: SyncChangeEvent): Promise<void> {
    if (change.operation === 'delete') {
      const payload = change.payload as { id?: unknown };
      const id = Number.parseInt(String(payload?.id ?? ''), 10);

      if (!Number.isInteger(id) || id <= 0) {
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
    const id = Number.parseInt(String(payload?.id ?? ''), 10);

    if (!Number.isInteger(id) || id <= 0) {
      return;
    }

    const normalized: Tag = {
      id,
      name:
        typeof payload.name === 'string' && payload.name.trim().length > 0
          ? payload.name.trim()
          : `Tag ${id}`,
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
      const id = Number.parseInt(String(payload?.id ?? ''), 10);

      if (Number.isInteger(id) && id > 0) {
        await this.db.views.delete(id);
      }
      return;
    }

    const payload = change.payload as Partial<GameListView>;
    const id = Number.parseInt(String(payload?.id ?? ''), 10);
    const normalized: GameListView = {
      id: Number.isInteger(id) && id > 0 ? id : undefined,
      name:
        typeof payload.name === 'string' && payload.name.trim().length > 0
          ? payload.name.trim()
          : 'Saved View',
      listType: payload.listType === 'wishlist' ? 'wishlist' : 'collection',
      filters: payload.filters ?? {
        sortField: 'title',
        sortDirection: 'asc',
        platform: [],
        collections: [],
        developers: [],
        franchises: [],
        publishers: [],
        gameTypes: [],
        genres: [],
        statuses: [],
        tags: [],
        ratings: [],
        hltbMainHoursMin: null,
        hltbMainHoursMax: null,
        releaseDateFrom: null,
        releaseDateTo: null
      },
      groupBy: payload.groupBy ?? 'none',
      createdAt:
        typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
      updatedAt:
        typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString()
    };

    await this.db.views.put(normalized);
  }

  private async applySettingChange(change: SyncChangeEvent): Promise<void> {
    if (change.operation === 'delete') {
      const payload = change.payload as { key?: unknown };
      const key = typeof payload?.key === 'string' ? payload.key.trim() : '';

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
    const key = typeof payload?.key === 'string' ? payload.key.trim() : '';
    const value = typeof payload?.value === 'string' ? payload.value : '';

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
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
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

    return navigator.onLine !== false;
  }

  private normalizeBaseUrl(value: string | null | undefined): string {
    const normalized = String(value ?? '').trim();
    return normalized.replace(/\/+$/, '');
  }

  private generateOperationId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
