import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SyncEventsService {
  private readonly changedSubject = new Subject<void>();
  readonly changed$ = this.changedSubject.asObservable();

  emitChanged(): void {
    this.changedSubject.next();
  }
}
