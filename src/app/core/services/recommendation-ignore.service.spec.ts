import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import {
  RECOMMENDATION_IGNORED_STORAGE_KEY,
  RecommendationIgnoreService
} from './recommendation-ignore.service';
import { SyncEventsService } from './sync-events.service';
import { SYNC_OUTBOX_WRITER } from '../data/sync-outbox-writer';

describe('RecommendationIgnoreService', () => {
  let changed$: Subject<void>;
  const outboxWriterMock = {
    enqueueOperation: vi.fn().mockResolvedValue(undefined)
  };

  function configureTestingModule(includeOutboxWriter = true): void {
    changed$ = new Subject<void>();
    const providers: Array<{ provide: object; useValue: object } | object> = [
      RecommendationIgnoreService,
      {
        provide: SyncEventsService,
        useValue: {
          changed$: changed$.asObservable()
        }
      }
    ];

    if (includeOutboxWriter) {
      providers.push({
        provide: SYNC_OUTBOX_WRITER,
        useValue: outboxWriterMock
      });
    }

    TestBed.configureTestingModule({
      providers
    });
  }

  beforeEach(() => {
    localStorage.removeItem(RECOMMENDATION_IGNORED_STORAGE_KEY);
    vi.clearAllMocks();
    configureTestingModule();
  });

  it('ignores by igdb id regardless of platform variants', () => {
    const service = TestBed.inject(RecommendationIgnoreService);
    service.ignoreGame({ igdbGameId: '700', title: 'Starfield' });
    service.ignoreGame({ igdbGameId: '700', title: 'Starfield (Xbox)' });

    const ignored = service.listIgnored();
    expect(ignored).toHaveLength(1);
    expect(ignored[0].igdbGameId).toBe('700');
    expect(service.isIgnored('700')).toBe(true);
  });

  it('emits ignored id sets and serialized payload values', () => {
    const service = TestBed.inject(RecommendationIgnoreService);
    const emitted: string[][] = [];
    const subscription = service.ignoredIds$.subscribe((ids) => {
      emitted.push(Array.from(ids.values()).sort());
    });

    expect(service.getSerializedSettingValue()).toBeNull();
    service.ignoreGame({ igdbGameId: '120', title: 'A' });
    const serialized = service.getSerializedSettingValue();
    expect(typeof serialized).toBe('string');
    expect(serialized).toContain('"version":1');
    expect(serialized).toContain('"igdbGameId":"120"');
    expect(emitted.at(-1)).toEqual(['120']);
    subscription.unsubscribe();
  });

  it('persists and restores entries from storage', () => {
    const service = TestBed.inject(RecommendationIgnoreService);
    service.ignoreGame({ igdbGameId: '101', title: 'Chrono Trigger' });

    TestBed.resetTestingModule();
    configureTestingModule();
    const reloaded = TestBed.inject(RecommendationIgnoreService);
    reloaded.refreshFromStorage();
    expect(reloaded.isIgnored('101')).toBe(true);
  });

  it('queues sync setting upsert and delete operations', () => {
    const service = TestBed.inject(RecommendationIgnoreService);
    service.ignoreGame({ igdbGameId: '1', title: 'A' });
    service.unignoreGame('1');

    const calls = outboxWriterMock.enqueueOperation.mock.calls as Array<
      [
        {
          entityType: 'setting' | 'game' | 'tag' | 'view';
          operation: 'upsert' | 'delete';
          payload: { key?: string };
        }
      ]
    >;
    const hasUpsert = calls.some(
      ([request]) =>
        request.entityType === 'setting' &&
        request.operation === 'upsert' &&
        request.payload.key === RECOMMENDATION_IGNORED_STORAGE_KEY
    );
    const hasDelete = calls.some(
      ([request]) =>
        request.entityType === 'setting' &&
        request.operation === 'delete' &&
        request.payload.key === RECOMMENDATION_IGNORED_STORAGE_KEY
    );

    expect(hasUpsert).toBe(true);
    expect(hasDelete).toBe(true);
  });

  it('handles invalid IDs and non-existing unignore as no-ops', () => {
    const service = TestBed.inject(RecommendationIgnoreService);
    service.ignoreGame({ igdbGameId: 'not-a-number', title: 'Invalid' });
    service.unignoreGame('also-invalid');
    service.unignoreGame('9999');

    expect(service.listIgnored()).toEqual([]);
    expect(outboxWriterMock.enqueueOperation).not.toHaveBeenCalled();
  });

  it('falls back to empty state when stored payload is malformed', () => {
    localStorage.setItem(RECOMMENDATION_IGNORED_STORAGE_KEY, '{bad json');
    const service = TestBed.inject(RecommendationIgnoreService);
    service.refreshFromStorage();
    expect(service.listIgnored()).toEqual([]);
  });

  it('falls back to empty state when stored payload version is unsupported', () => {
    localStorage.setItem(
      RECOMMENDATION_IGNORED_STORAGE_KEY,
      JSON.stringify({
        version: 999,
        entries: [
          { igdbGameId: '101', title: 'Chrono Trigger', ignoredAt: '2026-03-09T00:00:00.000Z' }
        ]
      })
    );
    const service = TestBed.inject(RecommendationIgnoreService);
    service.refreshFromStorage();
    expect(service.listIgnored()).toEqual([]);
  });

  it('ignores non-object payloads and payloads with non-array entries', () => {
    localStorage.setItem(RECOMMENDATION_IGNORED_STORAGE_KEY, JSON.stringify([]));
    const service = TestBed.inject(RecommendationIgnoreService);
    service.refreshFromStorage();
    expect(service.listIgnored()).toEqual([]);

    localStorage.setItem(
      RECOMMENDATION_IGNORED_STORAGE_KEY,
      JSON.stringify({ version: 1, entries: 'bad' })
    );
    changed$.next();
    expect(service.listIgnored()).toEqual([]);
  });

  it('sorts ignored entries by title then igdb id', () => {
    localStorage.setItem(
      RECOMMENDATION_IGNORED_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          { igdbGameId: '15', title: 'zeta', ignoredAt: '2026-01-01T00:00:00.000Z' },
          { igdbGameId: '2', title: 'Alpha', ignoredAt: '2026-01-01T00:00:00.000Z' },
          { igdbGameId: '10', title: 'alpha', ignoredAt: '2026-01-01T00:00:00.000Z' }
        ]
      })
    );
    const service = TestBed.inject(RecommendationIgnoreService);
    service.refreshFromStorage();

    expect(service.listIgnored().map((entry) => entry.igdbGameId)).toEqual(['10', '2', '15']);
  });

  it('drops invalid entries while preserving valid ones from storage payload', () => {
    localStorage.setItem(
      RECOMMENDATION_IGNORED_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          { igdbGameId: 'abc', title: 'Invalid', ignoredAt: '2026-01-01T00:00:00.000Z' },
          { igdbGameId: '42', title: 'Valid', ignoredAt: '2026-01-01T00:00:00.000Z' }
        ]
      })
    );
    const service = TestBed.inject(RecommendationIgnoreService);
    service.refreshFromStorage();

    expect(service.listIgnored()).toEqual([
      { igdbGameId: '42', title: 'Valid', ignoredAt: '2026-01-01T00:00:00.000Z' }
    ]);
  });

  it('keeps valid entries when payload also contains null and primitive entries', () => {
    localStorage.setItem(
      RECOMMENDATION_IGNORED_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          null,
          123,
          { igdbGameId: '55', title: 'Valid 55', ignoredAt: '2026-01-01T00:00:00.000Z' },
          'bad',
          { igdbGameId: 'bad-id', title: 'Invalid', ignoredAt: '2026-01-01T00:00:00.000Z' }
        ]
      })
    );
    const service = TestBed.inject(RecommendationIgnoreService);
    service.refreshFromStorage();

    expect(service.listIgnored()).toEqual([
      { igdbGameId: '55', title: 'Valid 55', ignoredAt: '2026-01-01T00:00:00.000Z' }
    ]);
  });

  it('works without sync outbox writer', () => {
    TestBed.resetTestingModule();
    configureTestingModule(false);
    const service = TestBed.inject(RecommendationIgnoreService);
    service.ignoreGame({ igdbGameId: '1', title: 'A' });
    service.unignoreGame('1');
    expect(service.listIgnored()).toEqual([]);
  });
});
