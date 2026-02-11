import { Pool } from 'pg';

export type SyncEntityType = 'game' | 'tag' | 'view' | 'setting';
export type SyncOperationType = 'upsert' | 'delete';

export interface ClientSyncOperation {
  opId: string;
  entityType: SyncEntityType;
  operation: SyncOperationType;
  payload: unknown;
  clientTimestamp: string;
}

export interface SyncChangeEvent {
  eventId: string;
  entityType: SyncEntityType;
  operation: SyncOperationType;
  payload: unknown;
  serverTimestamp: string;
}

export interface SyncPushResult {
  opId: string;
  status: 'applied' | 'duplicate' | 'failed';
  message?: string;
  normalizedPayload?: unknown;
}

export interface AppServices {
  pool: Pool;
}

