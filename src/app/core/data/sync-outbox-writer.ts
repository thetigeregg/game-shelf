import { InjectionToken } from '@angular/core';
import { SyncEntityType, SyncOperationType } from '../models/game.models';
import { OutboxEntry } from './app-db';

export interface SyncOutboxWriteRequest {
  opId?: string;
  entityType: SyncEntityType;
  operation: SyncOperationType;
  payload: unknown;
  clientTimestamp?: string;
}

export interface SyncOutboxWriter {
  enqueueOperation(request: SyncOutboxWriteRequest): Promise<void>;
  syncNow?(): Promise<void>;
  onOutboxEntryEnqueued?(entry: OutboxEntry): void;
}

export const SYNC_OUTBOX_WRITER = new InjectionToken<SyncOutboxWriter>('SYNC_OUTBOX_WRITER');
