import { Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, map } from 'rxjs';
import { SyncEventsService } from './sync-events.service';
import { SYNC_OUTBOX_WRITER, SyncOutboxWriter } from '../data/sync-outbox-writer';

const RECOMMENDATION_IGNORED_PAYLOAD_VERSION = 1;

interface RecommendationIgnoredPayload {
  version: number;
  entries: RecommendationIgnoredEntry[];
}

export interface RecommendationIgnoredEntry {
  igdbGameId: string;
  title: string;
  ignoredAt: string;
}

export const RECOMMENDATION_IGNORED_STORAGE_KEY = 'game-shelf:recommendation-ignored-games';

@Injectable({ providedIn: 'root' })
export class RecommendationIgnoreService {
  private readonly syncEvents = inject(SyncEventsService);
  private readonly outboxWriter = inject<SyncOutboxWriter | null>(SYNC_OUTBOX_WRITER, {
    optional: true
  });
  private readonly entriesSubject = new BehaviorSubject<RecommendationIgnoredEntry[]>(
    this.readEntriesFromStorage()
  );
  private ignoredIdSet = new Set(this.entriesSubject.value.map((entry) => entry.igdbGameId));

  readonly ignoredEntries$ = this.entriesSubject.asObservable();
  readonly ignoredIds$ = this.ignoredEntries$.pipe(
    map((entries) => new Set(entries.map((entry) => entry.igdbGameId)))
  );

  constructor() {
    this.syncEvents.changed$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.refreshFromStorage();
    });
  }

  refreshFromStorage(): void {
    this.setEntries(this.readEntriesFromStorage());
  }

  getSerializedSettingValue(): string | null {
    if (this.entriesSubject.value.length === 0) {
      return null;
    }

    const payload: RecommendationIgnoredPayload = {
      version: RECOMMENDATION_IGNORED_PAYLOAD_VERSION,
      entries: this.entriesSubject.value
    };
    return JSON.stringify(payload);
  }

  isIgnored(igdbGameId: string): boolean {
    const normalized = this.normalizeGameId(igdbGameId);
    return normalized !== null && this.ignoredIdSet.has(normalized);
  }

  listIgnored(): RecommendationIgnoredEntry[] {
    return [...this.entriesSubject.value];
  }

  ignoreGame(params: { igdbGameId: string; title: string }): void {
    const igdbGameId = this.normalizeGameId(params.igdbGameId);
    if (igdbGameId === null) {
      return;
    }

    const title = this.normalizeTitle(params.title);
    const now = new Date().toISOString();
    const existing = this.entriesSubject.value.find((entry) => entry.igdbGameId === igdbGameId);
    const nextEntries = this.entriesSubject.value.filter(
      (entry) => entry.igdbGameId !== igdbGameId
    );
    nextEntries.push({
      igdbGameId,
      title: title.length > 0 ? title : (existing?.title ?? `Game #${igdbGameId}`),
      ignoredAt: existing?.ignoredAt ?? now
    });
    this.persistEntries(nextEntries);
  }

  unignoreGame(igdbGameId: string): void {
    const normalized = this.normalizeGameId(igdbGameId);
    if (normalized === null) {
      return;
    }

    const nextEntries = this.entriesSubject.value.filter(
      (entry) => entry.igdbGameId !== normalized
    );
    if (nextEntries.length === this.entriesSubject.value.length) {
      return;
    }

    this.persistEntries(nextEntries);
  }

  private persistEntries(entries: RecommendationIgnoredEntry[]): void {
    const normalizedEntries = this.normalizeEntries(entries);
    if (normalizedEntries.length === 0) {
      try {
        localStorage.removeItem(RECOMMENDATION_IGNORED_STORAGE_KEY);
      } catch {
        // Ignore storage failures.
      }
      this.setEntries([]);
      this.queueDelete();
      return;
    }

    const payload: RecommendationIgnoredPayload = {
      version: RECOMMENDATION_IGNORED_PAYLOAD_VERSION,
      entries: normalizedEntries
    };

    try {
      localStorage.setItem(RECOMMENDATION_IGNORED_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures.
    }

    this.setEntries(normalizedEntries);
    this.queueUpsert(JSON.stringify(payload));
  }

  private readEntriesFromStorage(): RecommendationIgnoredEntry[] {
    try {
      const raw = localStorage.getItem(RECOMMENDATION_IGNORED_STORAGE_KEY);
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        return [];
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return [];
      }

      const payload = parsed as Partial<RecommendationIgnoredPayload>;
      if (payload.version !== RECOMMENDATION_IGNORED_PAYLOAD_VERSION) {
        return [];
      }

      if (!Array.isArray(payload.entries)) {
        return [];
      }

      return this.normalizeEntries(payload.entries);
    } catch {
      return [];
    }
  }

  private normalizeEntries(entries: RecommendationIgnoredEntry[]): RecommendationIgnoredEntry[] {
    const byGameId = new Map<string, RecommendationIgnoredEntry>();

    for (const entry of entries) {
      const igdbGameId = this.normalizeGameId(entry.igdbGameId);
      if (igdbGameId === null) {
        continue;
      }

      const title = this.normalizeTitle(entry.title);
      const ignoredAt =
        typeof entry.ignoredAt === 'string' && entry.ignoredAt.trim().length > 0
          ? entry.ignoredAt
          : new Date().toISOString();

      byGameId.set(igdbGameId, {
        igdbGameId,
        title: title.length > 0 ? title : `Game #${igdbGameId}`,
        ignoredAt
      });
    }

    return Array.from(byGameId.values()).sort((a, b) => {
      const titleCompare = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      if (titleCompare !== 0) {
        return titleCompare;
      }
      return a.igdbGameId.localeCompare(b.igdbGameId);
    });
  }

  private normalizeGameId(value: string): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return /^\d+$/.test(normalized) ? normalized : null;
  }

  private normalizeTitle(value: string): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private setEntries(entries: RecommendationIgnoredEntry[]): void {
    this.entriesSubject.next(entries);
    this.ignoredIdSet = new Set(entries.map((entry) => entry.igdbGameId));
  }

  private queueUpsert(value: string): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: RECOMMENDATION_IGNORED_STORAGE_KEY,
        value
      }
    });
  }

  private queueDelete(): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'setting',
      operation: 'delete',
      payload: {
        key: RECOMMENDATION_IGNORED_STORAGE_KEY
      }
    });
  }
}
