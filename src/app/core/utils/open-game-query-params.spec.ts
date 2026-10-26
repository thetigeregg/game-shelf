import { describe, expect, it } from 'vitest';
import { parseOpenGamePlatformId } from './open-game-query-params';

describe('parseOpenGamePlatformId', () => {
  it('accepts positive integers as numbers or whole decimal strings', () => {
    expect(parseOpenGamePlatformId(167)).toBe(167);
    expect(parseOpenGamePlatformId('167')).toBe(167);
  });

  it('rejects partial, non-decimal, non-positive, and non-numeric values', () => {
    for (const value of [
      '167junk',
      '167.5',
      167.5,
      '0x10',
      '1e2',
      ' 167',
      '',
      '0',
      0,
      -1,
      '-1',
      Number.NaN,
      '9007199254740993',
      null,
      undefined,
      {},
    ]) {
      expect(parseOpenGamePlatformId(value)).toBeNull();
    }
  });
});
