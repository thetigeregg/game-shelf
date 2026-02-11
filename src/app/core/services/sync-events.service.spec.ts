import { TestBed } from '@angular/core/testing';
import { firstValueFrom, take } from 'rxjs';
import { SyncEventsService } from './sync-events.service';

describe('SyncEventsService', () => {
  it('emits changed events', async () => {
    TestBed.configureTestingModule({
      providers: [SyncEventsService],
    });

    const service = TestBed.inject(SyncEventsService);
    const once = firstValueFrom(service.changed$.pipe(take(1)));
    service.emitChanged();

    await expect(once).resolves.toBeUndefined();
  });
});

