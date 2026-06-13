import { describe, expect, it } from 'vitest';
import { isStorageConstraintError } from './storage-engine';

describe('isStorageConstraintError', () => {
  it('matches Error objects with constraint names', () => {
    expect(
      isStorageConstraintError(Object.assign(new Error('duplicate'), { name: 'ConstraintError' }))
    ).toBe(true);
    expect(
      isStorageConstraintError(Object.assign(new Error('invalid'), { name: 'DataError' }))
    ).toBe(true);
  });

  it('matches DOMException constraint errors that are not instanceof Error', () => {
    const domException = new DOMException('duplicate key', 'ConstraintError');

    expect(domException instanceof Error).toBe(false);
    expect(isStorageConstraintError(domException)).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isStorageConstraintError(new Error('other'))).toBe(false);
    expect(isStorageConstraintError(null)).toBe(false);
    expect(isStorageConstraintError('ConstraintError')).toBe(false);
  });
});
