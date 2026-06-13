const STORAGE_TRANSACTION_ZONE_KEY = 'gameShelf.storageTransaction';

/**
 * True when the current async chain is executing inside an active
 * runInTransaction action. Used to distinguish nested calls from concurrent
 * callers so only the latter are serialized behind the transaction queue.
 */
export function isInsideStorageTransaction(): boolean {
  return Zone.current.get(STORAGE_TRANSACTION_ZONE_KEY) === true;
}

/** Runs action in a forked Zone so nested runInTransaction calls can detect it. */
export function runInsideStorageTransactionZone<T>(action: () => Promise<T>): Promise<T> {
  const zone = Zone.current.fork({
    name: 'storage-transaction',
    properties: {
      [STORAGE_TRANSACTION_ZONE_KEY]: true,
    },
  });

  return zone.run(() => {
    try {
      return action();
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
