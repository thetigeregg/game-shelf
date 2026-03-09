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

  function configureTestingModule(): void {
    changed$ = new Subject<void>();
    TestBed.configureTestingModule({
      providers: [
        RecommendationIgnoreService,
        {
          provide: SyncEventsService,
          useValue: {
            changed$: changed$.asObservable()
          }
        },
        {
          provide: SYNC_OUTBOX_WRITER,
          useValue: outboxWriterMock
        }
      ]
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

  it('falls back to empty state when stored payload is malformed', () => {
    localStorage.setItem(RECOMMENDATION_IGNORED_STORAGE_KEY, '{bad json');
    const service = TestBed.inject(RecommendationIgnoreService);
    service.refreshFromStorage();
    expect(service.listIgnored()).toEqual([]);
  });
});
