import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  registerPlugin: vi.fn((_name: string, implementations?: { web?: () => unknown }) => {
    return implementations?.web?.() ?? {};
  }),
}));

import { NativeLogger } from './native-logger.plugin';

describe('NativeLoggerPlugin web stub', () => {
  it('log resolves without error', async () => {
    await expect(
      NativeLogger.log({ level: 'info', message: 'test.message' })
    ).resolves.toBeUndefined();
  });

  it('log resolves with optional details', async () => {
    await expect(
      NativeLogger.log({ level: 'warn', message: 'test.message', details: 'extra' })
    ).resolves.toBeUndefined();
  });

  it('exportLogs resolves with empty content string', async () => {
    const result = await NativeLogger.exportLogs();
    expect(result).toEqual({ content: '' });
  });

  it('clearLogs resolves without error', async () => {
    await expect(NativeLogger.clearLogs()).resolves.toBeUndefined();
  });
});
