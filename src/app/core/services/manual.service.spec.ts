import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SyncOutboxWriter, SYNC_OUTBOX_WRITER } from '../data/sync-outbox-writer';
import { ManualService, MANUAL_OVERRIDES_STORAGE_KEY } from './manual.service';

class OutboxWriterMock implements SyncOutboxWriter {
  calls: Array<{ entityType: string; operation: string; payload: unknown }> = [];

  enqueueOperation(request: {
    entityType: string;
    operation: string;
    payload: unknown;
  }): Promise<void> {
    this.calls.push(request);
    return Promise.resolve();
  }
}

describe('ManualService', () => {
  let service: ManualService;
  let httpMock: HttpTestingController;
  let outboxWriter: OutboxWriterMock;

  beforeEach(() => {
    outboxWriter = new OutboxWriterMock();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ManualService,
        { provide: SYNC_OUTBOX_WRITER, useValue: outboxWriter }
      ]
    });

    localStorage.clear();
    service = TestBed.inject(ManualService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('calls resolve endpoint and preserves override preference path', async () => {
    const promise = firstValueFrom(
      service.resolveManual(
        {
          igdbGameId: '100',
          platformIgdbId: 8,
          title: 'God of War II'
        },
        'PlayStation 2__pid-8/God of War II.pdf'
      )
    );

    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/manuals/resolve` &&
        request.params.get('igdbGameId') === '100' &&
        request.params.get('platformIgdbId') === '8' &&
        request.params.get('title') === 'God of War II' &&
        request.params.get('preferredRelativePath') === 'PlayStation 2__pid-8/God of War II.pdf'
      );
    });

    req.flush({
      status: 'matched',
      bestMatch: {
        source: 'override',
        platformIgdbId: 8,
        fileName: 'God of War II.pdf',
        relativePath: 'PlayStation 2__pid-8/God of War II.pdf',
        score: 1,
        url: '/manuals/PlayStation%202__pid-8/God%20of%20War%20II.pdf'
      },
      candidates: []
    });

    await expect(promise).resolves.toEqual({
      status: 'matched',
      bestMatch: {
        source: 'override',
        platformIgdbId: 8,
        fileName: 'God of War II.pdf',
        relativePath: 'PlayStation 2__pid-8/God of War II.pdf',
        score: 1,
        url: '/manuals/PlayStation%202__pid-8/God%20of%20War%20II.pdf'
      },
      candidates: [],
      unavailable: false,
      reason: null
    });
  });

  it('saves override and queues setting sync upsert', () => {
    service.setOverride(
      {
        igdbGameId: '100',
        platformIgdbId: 8
      },
      'PlayStation 2__pid-8/God of War II.pdf'
    );

    const raw = localStorage.getItem(MANUAL_OVERRIDES_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(String(raw)) as Record<string, { relativePath: string }>;
    expect(parsed['100::8'].relativePath).toBe('PlayStation 2__pid-8/God of War II.pdf');
    expect(
      outboxWriter.calls.some((call) => {
        return (
          call.entityType === 'setting' &&
          call.operation === 'upsert' &&
          (call.payload as { key?: string }).key === MANUAL_OVERRIDES_STORAGE_KEY
        );
      })
    ).toBe(true);
  });

  it('clears override and queues setting delete when map is empty', () => {
    service.setOverride(
      {
        igdbGameId: '100',
        platformIgdbId: 8
      },
      'PlayStation 2__pid-8/God of War II.pdf'
    );
    outboxWriter.calls = [];

    service.clearOverride({
      igdbGameId: '100',
      platformIgdbId: 8
    });

    expect(localStorage.getItem(MANUAL_OVERRIDES_STORAGE_KEY)).toBeNull();
    expect(
      outboxWriter.calls.some((call) => {
        return (
          call.entityType === 'setting' &&
          call.operation === 'delete' &&
          (call.payload as { key?: string }).key === MANUAL_OVERRIDES_STORAGE_KEY
        );
      })
    ).toBe(true);
  });

  it('returns fallback when resolve request fails', async () => {
    const promise = firstValueFrom(
      service.resolveManual({
        igdbGameId: '100',
        platformIgdbId: 8,
        title: 'God of War II'
      })
    );

    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/manuals/resolve` &&
        request.params.get('igdbGameId') === '100' &&
        request.params.get('platformIgdbId') === '8' &&
        request.params.get('title') === 'God of War II'
      );
    });
    req.flush({ error: 'down' }, { status: 500, statusText: 'Server Error' });

    await expect(promise).resolves.toEqual({
      status: 'none',
      candidates: [],
      unavailable: true,
      reason: 'Unable to resolve manuals right now.'
    });
  });

  it('encodes semicolons in resolve query params', async () => {
    const promise = firstValueFrom(
      service.resolveManual({
        igdbGameId: '11393',
        platformIgdbId: 46,
        title: 'Chaos;Child'
      })
    );

    const req = httpMock.expectOne((request) => {
      return (
        request.urlWithParams ===
        `${environment.gameApiBaseUrl}/v1/manuals/resolve?igdbGameId=11393&platformIgdbId=46&title=Chaos%3BChild`
      );
    });
    req.flush({
      status: 'none',
      candidates: []
    });

    await expect(promise).resolves.toEqual({
      status: 'none',
      bestMatch: null,
      candidates: [],
      unavailable: false,
      reason: null
    });
  });

  it('returns empty search list when platform id is invalid without HTTP call', async () => {
    await expect(firstValueFrom(service.searchManuals(0, 'mario'))).resolves.toEqual({
      items: [],
      unavailable: false,
      reason: null
    });

    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/manuals/search`);
  });

  it('maps search response and fallback URL when candidate URL is missing', async () => {
    const promise = firstValueFrom(service.searchManuals(8, 'god'));

    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/manuals/search` &&
        request.params.get('platformIgdbId') === '8' &&
        request.params.get('q') === 'god'
      );
    });

    req.flush({
      items: [
        {
          platformIgdbId: 8,
          fileName: 'God of War II.pdf',
          relativePath: 'PlayStation 2__pid-8/God of War II.pdf',
          score: 0.92
        }
      ]
    });

    await expect(promise).resolves.toEqual({
      unavailable: false,
      reason: null,
      items: [
        {
          platformIgdbId: 8,
          fileName: 'God of War II.pdf',
          relativePath: 'PlayStation 2__pid-8/God of War II.pdf',
          score: 0.92,
          url: '/manuals/PlayStation%202__pid-8/God%20of%20War%20II.pdf'
        }
      ]
    });
  });

  it('reads and normalizes existing override map from localStorage', () => {
    localStorage.setItem(
      MANUAL_OVERRIDES_STORAGE_KEY,
      JSON.stringify({
        '100::8': {
          relativePath: 'PlayStation 2__pid-8\\God of War II.pdf',
          updatedAt: '2026-02-12T00:00:00.000Z'
        },
        'bad::entry': {
          relativePath: '../bad.pdf'
        }
      })
    );

    expect(
      service.getOverride({
        igdbGameId: '100',
        platformIgdbId: 8
      })
    ).toEqual({
      relativePath: 'PlayStation 2__pid-8/God of War II.pdf',
      updatedAt: '2026-02-12T00:00:00.000Z'
    });
  });
});
