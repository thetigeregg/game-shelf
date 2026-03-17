import { OutboxEntry } from './app-db';

export type OutboxEntryBuildRequest = {
  opId?: string | null;
  entityType: OutboxEntry['entityType'];
  operation: OutboxEntry['operation'];
  payload: OutboxEntry['payload'];
  clientTimestamp?: string | null;
};

export function generateOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildOutboxEntry(
  request: OutboxEntryBuildRequest,
  generateId: () => string = generateOperationId,
  createdAt: string = new Date().toISOString()
): OutboxEntry {
  const opId = typeof request.opId === 'string' ? request.opId.trim() : '';
  const rawClientTimestamp =
    typeof request.clientTimestamp === 'string' ? request.clientTimestamp.trim() : '';
  const clientTimestamp = rawClientTimestamp.length > 0 ? rawClientTimestamp : createdAt;

  return {
    opId: opId.length > 0 ? opId : generateId(),
    entityType: request.entityType,
    operation: request.operation,
    payload: request.payload,
    clientTimestamp,
    createdAt,
    attemptCount: 0,
    lastError: null,
  };
}
