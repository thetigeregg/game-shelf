import { AsyncLocalStorage } from 'node:async_hooks';

const storageTransactionContext = new AsyncLocalStorage<boolean>();

/**
 * True when the current async chain is executing inside an active
 * runInTransaction action. Used to distinguish nested calls from concurrent
 * callers so only the latter are serialized behind the transaction queue.
 */
export function isInsideStorageTransaction(): boolean {
  return storageTransactionContext.getStore() === true;
}

/** Runs action in async context so nested runInTransaction calls can detect it. */
export function runInsideStorageTransactionZone<T>(action: () => Promise<T>): Promise<T> {
  return Promise.resolve(storageTransactionContext.run(true, action));
}
