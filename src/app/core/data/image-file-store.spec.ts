import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const statMock = vi.fn<() => Promise<unknown>>();
const getUriMock = vi.fn<() => Promise<{ uri: string }>>();
const writeFileMock = vi.fn<() => Promise<void>>();
const deleteFileMock = vi.fn<() => Promise<void>>();
const rmdirMock = vi.fn<() => Promise<void>>();
const convertFileSrcMock = vi.fn<(path: string) => string>();

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: {
    stat: (...args: unknown[]) => statMock(...args),
    getUri: (...args: unknown[]) => getUriMock(...args),
    writeFile: (...args: unknown[]) => writeFileMock(...args),
    deleteFile: (...args: unknown[]) => deleteFileMock(...args),
    rmdir: (...args: unknown[]) => rmdirMock(...args),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    convertFileSrc: (path: string) => convertFileSrcMock(path),
    isNativePlatform: () => false,
  },
  registerPlugin: vi.fn().mockReturnValue({}),
}));

import { ImageFileStore } from './image-file-store';
import { DebugLogService } from '../services/debug-log.service';

function makeDebugLogStub(): DebugLogService {
  return {
    trace: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as DebugLogService;
}

describe('ImageFileStore', () => {
  let store: ImageFileStore;
  let debugLog: DebugLogService;

  beforeEach(() => {
    debugLog = makeDebugLogStub();
    TestBed.configureTestingModule({
      providers: [ImageFileStore, { provide: DebugLogService, useValue: debugLog }],
    });
    store = TestBed.inject(ImageFileStore);
    writeFileMock.mockResolvedValue(undefined);
    deleteFileMock.mockResolvedValue(undefined);
    rmdirMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
    TestBed.resetTestingModule();
  });

  describe('writeImage', () => {
    it('writes hashed file and returns filePath and sizeBytes', async () => {
      const traceSpy = vi.spyOn(debugLog, 'trace');
      const blob = new Blob(['fake-image-data'], { type: 'image/png' });

      const result = await store.writeImage('test-cache-key', blob);

      expect(writeFileMock).toHaveBeenCalledWith(expect.objectContaining({ recursive: true }));
      expect(result.sizeBytes).toBe(blob.size);
      expect(result.filePath).toMatch(/^image-cache\//);
      expect(traceSpy).toHaveBeenCalledWith(
        'image_store.write',
        expect.objectContaining({ sizeBytes: blob.size })
      );
      expect(traceSpy).toHaveBeenCalledWith('image_store.write_complete', expect.any(Object));
    });
  });

  describe('getDisplayUrl', () => {
    it('returns null and traces file_missing when stat throws', async () => {
      const traceSpy = vi.spyOn(debugLog, 'trace');
      statMock.mockRejectedValue(new Error('not found'));

      const result = await store.getDisplayUrl('image-cache/abc');

      expect(result).toBeNull();
      expect(traceSpy).toHaveBeenCalledWith(
        'image_store.file_missing',
        expect.objectContaining({ filePath: 'image-cache/abc' })
      );
    });

    it('returns display URL when file exists', async () => {
      const traceSpy = vi.spyOn(debugLog, 'trace');
      statMock.mockResolvedValue({});
      getUriMock.mockResolvedValue({ uri: 'file:///var/cache/image-cache/abc' });
      convertFileSrcMock.mockReturnValue('capacitor://localhost/image-cache/abc');

      const result = await store.getDisplayUrl('image-cache/abc');

      expect(result).toBe('capacitor://localhost/image-cache/abc');
      expect(traceSpy).toHaveBeenCalledWith(
        'image_store.display_url_resolved',
        expect.objectContaining({ filePath: 'image-cache/abc' })
      );
    });
  });

  describe('deleteImage', () => {
    it('traces deleted on success', async () => {
      const traceSpy = vi.spyOn(debugLog, 'trace');

      await store.deleteImage('image-cache/abc');

      expect(deleteFileMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'image-cache/abc' })
      );
      expect(traceSpy).toHaveBeenCalledWith(
        'image_store.deleted',
        expect.objectContaining({ filePath: 'image-cache/abc' })
      );
    });

    it('traces delete_failed without throwing when delete errors', async () => {
      const traceSpy = vi.spyOn(debugLog, 'trace');
      deleteFileMock.mockRejectedValue(new Error('evicted'));

      await expect(store.deleteImage('image-cache/abc')).resolves.toBeUndefined();
      expect(traceSpy).toHaveBeenCalledWith(
        'image_store.delete_failed',
        expect.objectContaining({ filePath: 'image-cache/abc', error: 'evicted' })
      );
    });
  });

  describe('clear', () => {
    it('traces cache_dir_cleared on success', async () => {
      const traceSpy = vi.spyOn(debugLog, 'trace');

      await store.clear();

      expect(rmdirMock).toHaveBeenCalledWith(expect.objectContaining({ recursive: true }));
      expect(traceSpy).toHaveBeenCalledWith('image_store.cache_dir_cleared');
    });

    it('silently swallows rmdir errors', async () => {
      rmdirMock.mockRejectedValue(new Error('dir not found'));

      await expect(store.clear()).resolves.toBeUndefined();
    });
  });
});
