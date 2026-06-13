import { afterEach, describe, expect, it, vi } from 'vitest';

const isNativePlatformMock = vi.fn<() => boolean>();
const pickFilesMock = vi.fn<() => Promise<{ files: unknown[] }>>();
const pickImagesMock = vi.fn<() => Promise<{ files: unknown[] }>>();
const convertFileSrcMock = vi.fn<(path: string) => string>();

vi.mock('./native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    convertFileSrc: (path: string) => convertFileSrcMock(path),
  },
}));

vi.mock('@capawesome/capacitor-file-picker', () => ({
  FilePicker: {
    pickFiles: (...args: unknown[]) => pickFilesMock(...args),
    pickImages: (...args: unknown[]) => pickImagesMock(...args),
  },
}));

import { pickCsvTextFile, pickImageFromFiles, pickImageFromPhotoLibrary } from './pick-file.util';

describe('pick-file.util', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    isNativePlatformMock.mockReset();
    pickFilesMock.mockReset();
    pickImagesMock.mockReset();
    convertFileSrcMock.mockReset();
  });

  function mockWebFileInput(file: File | null): void {
    const input = document.createElement('input');
    const click = vi.fn(() => {
      if (file) {
        Object.defineProperty(input, 'files', {
          configurable: true,
          value: [file],
        });
        input.dispatchEvent(new Event('change'));
      } else {
        input.dispatchEvent(new Event('cancel'));
      }
    });

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'input') {
        input.click = click;
        return input;
      }

      throw new Error(`Unexpected createElement call: ${tagName}`);
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    vi.spyOn(input, 'remove').mockImplementation(() => undefined);
  }

  function mockWebFileInputDismissViaFocus(): void {
    const input = document.createElement('input');
    const click = vi.fn(() => {
      window.dispatchEvent(new Event('focus'));
    });

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'input') {
        input.click = click;
        return input;
      }

      throw new Error(`Unexpected createElement call: ${tagName}`);
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    vi.spyOn(input, 'remove').mockImplementation(() => undefined);
  }

  it('returns CSV text from the native file picker', async () => {
    isNativePlatformMock.mockReturnValue(true);
    convertFileSrcMock.mockReturnValue('capacitor://localhost/_capacitor_file_/import.csv');
    pickFilesMock.mockResolvedValue({
      files: [
        {
          name: 'import.csv',
          mimeType: 'text/csv',
          path: '/picked/import.csv',
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () =>
          Promise.resolve(new Blob(['type,title\n"game","Example"'], { type: 'text/csv' })),
      })
    );

    const result = await pickCsvTextFile();

    expect(pickFilesMock).toHaveBeenCalledWith({
      types: ['text/csv', 'text/comma-separated-values', 'text/plain'],
      limit: 1,
    });
    expect(result).toEqual({
      status: 'picked',
      text: 'type,title\n"game","Example"',
      name: 'import.csv',
    });
  });

  it('returns cancelled when native CSV pick returns no files', async () => {
    isNativePlatformMock.mockReturnValue(true);
    pickFilesMock.mockResolvedValue({ files: [] });

    await expect(pickCsvTextFile()).resolves.toEqual({ status: 'cancelled' });
  });

  it('returns cancelled when native CSV pick is dismissed', async () => {
    isNativePlatformMock.mockReturnValue(true);
    pickFilesMock.mockRejectedValue(new DOMException('Picker canceled', 'AbortError'));

    await expect(pickCsvTextFile()).resolves.toEqual({ status: 'cancelled' });
  });

  it('returns a File from the native photo library picker', async () => {
    isNativePlatformMock.mockReturnValue(true);
    convertFileSrcMock.mockReturnValue('capacitor://localhost/_capacitor_file_/cover.jpg');
    pickImagesMock.mockResolvedValue({
      files: [
        {
          name: 'cover.jpg',
          mimeType: 'image/jpeg',
          path: '/picked/cover.jpg',
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['image-bytes'], { type: 'image/jpeg' })),
      })
    );

    const result = await pickImageFromPhotoLibrary();

    expect(pickImagesMock).toHaveBeenCalledWith({ limit: 1 });
    expect(result.status).toBe('picked');

    if (result.status === 'picked') {
      expect(result.file.name).toBe('cover.jpg');
      expect(result.file.type).toBe('image/jpeg');
    }
  });

  it('returns a File from the native files image picker', async () => {
    isNativePlatformMock.mockReturnValue(true);
    convertFileSrcMock.mockReturnValue('capacitor://localhost/_capacitor_file_/cover.png');
    pickFilesMock.mockResolvedValue({
      files: [
        {
          name: 'cover.png',
          mimeType: 'image/png',
          path: '/picked/cover.png',
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['image-bytes'], { type: 'image/png' })),
      })
    );

    const result = await pickImageFromFiles();

    expect(pickFilesMock).toHaveBeenCalledWith({
      types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
      limit: 1,
    });
    expect(result.status).toBe('picked');

    if (result.status === 'picked') {
      expect(result.file.name).toBe('cover.png');
      expect(result.file.type).toBe('image/png');
    }
  });

  it('returns cancelled when native image pick is dismissed', async () => {
    isNativePlatformMock.mockReturnValue(true);
    pickImagesMock.mockRejectedValue(new Error('User canceled picker'));

    await expect(pickImageFromPhotoLibrary()).resolves.toEqual({ status: 'cancelled' });
  });

  it('rethrows unexpected native picker failures', async () => {
    isNativePlatformMock.mockReturnValue(true);
    pickFilesMock.mockRejectedValue(new Error('picker failed'));

    await expect(pickImageFromFiles()).rejects.toThrow('picker failed');
  });

  it('returns CSV text from the web file input', async () => {
    isNativePlatformMock.mockReturnValue(false);
    mockWebFileInput(
      new File(['type,title\n"game","Example"'], 'import.csv', { type: 'text/csv' })
    );

    const result = await pickCsvTextFile();

    expect(pickFilesMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'picked',
      text: 'type,title\n"game","Example"',
      name: 'import.csv',
    });
  });

  it('returns cancelled when the web file input is dismissed', async () => {
    isNativePlatformMock.mockReturnValue(false);
    mockWebFileInput(null);

    await expect(pickCsvTextFile()).resolves.toEqual({ status: 'cancelled' });
  });

  it('returns cancelled when the web file input is dismissed without a cancel event', async () => {
    vi.useFakeTimers();
    isNativePlatformMock.mockReturnValue(false);
    mockWebFileInputDismissViaFocus();

    const resultPromise = pickCsvTextFile();
    await vi.advanceTimersByTimeAsync(500);

    await expect(resultPromise).resolves.toEqual({ status: 'cancelled' });
    vi.useRealTimers();
  });

  it('returns a File from the web image input', async () => {
    isNativePlatformMock.mockReturnValue(false);
    const file = new File(['image-bytes'], 'cover.webp', { type: 'image/webp' });
    mockWebFileInput(file);

    const result = await pickImageFromPhotoLibrary();

    expect(pickImagesMock).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'picked', file });
  });

  it('returns a File from the web files image picker', async () => {
    isNativePlatformMock.mockReturnValue(false);
    const file = new File(['image-bytes'], 'cover.png', { type: 'image/png' });
    mockWebFileInput(file);

    const result = await pickImageFromFiles();

    expect(pickFilesMock).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'picked', file });
  });

  it('returns cancelled when the web file input is dismissed for images', async () => {
    isNativePlatformMock.mockReturnValue(false);
    mockWebFileInput(null);

    await expect(pickImageFromFiles()).resolves.toEqual({ status: 'cancelled' });
  });

  it('returns cancelled when document is unavailable', async () => {
    isNativePlatformMock.mockReturnValue(false);
    vi.stubGlobal('document', undefined);

    await expect(pickCsvTextFile()).resolves.toEqual({ status: 'cancelled' });
  });

  it('propagates web CSV read failures', async () => {
    isNativePlatformMock.mockReturnValue(false);
    const file = new File(['csv'], 'import.csv', { type: 'text/csv' });
    vi.spyOn(file, 'text').mockRejectedValue(new Error('read failed'));
    mockWebFileInput(file);

    await expect(pickCsvTextFile()).rejects.toThrow('read failed');
  });

  it('throws when native CSV file cannot be converted', async () => {
    isNativePlatformMock.mockReturnValue(true);
    pickFilesMock.mockResolvedValue({
      files: [{ name: 'import.csv', mimeType: 'text/csv' }],
    });

    await expect(pickCsvTextFile()).rejects.toThrow('Unable to read picked file');
  });

  it('rethrows unexpected native CSV picker failures', async () => {
    isNativePlatformMock.mockReturnValue(true);
    pickFilesMock.mockRejectedValue(new Error('picker failed'));

    await expect(pickCsvTextFile()).rejects.toThrow('picker failed');
  });

  it('returns cancelled when native image pick returns no files', async () => {
    isNativePlatformMock.mockReturnValue(true);
    pickImagesMock.mockResolvedValue({ files: [] });

    await expect(pickImageFromPhotoLibrary()).resolves.toEqual({ status: 'cancelled' });
  });

  it('returns cancelled when native image file cannot be converted', async () => {
    isNativePlatformMock.mockReturnValue(true);
    pickImagesMock.mockResolvedValue({
      files: [{ name: 'cover.jpg', mimeType: 'image/jpeg' }],
    });

    await expect(pickImageFromPhotoLibrary()).resolves.toEqual({ status: 'cancelled' });
  });

  it('returns a File from a native picker blob result', async () => {
    isNativePlatformMock.mockReturnValue(true);
    const blob = new Blob(['image-bytes'], { type: 'image/jpeg' });
    pickImagesMock.mockResolvedValue({
      files: [{ name: 'cover.jpg', mimeType: 'image/jpeg', blob }],
    });

    const result = await pickImageFromPhotoLibrary();

    expect(result.status).toBe('picked');
    if (result.status === 'picked') {
      expect(result.file.name).toBe('cover.jpg');
      expect(result.file.type).toBe('image/jpeg');
    }
  });

  it('uses blob mime type when picked blob mime type is missing', async () => {
    isNativePlatformMock.mockReturnValue(true);
    const blob = new Blob(['image-bytes'], { type: 'image/jpeg' });
    pickImagesMock.mockResolvedValue({
      files: [{ name: 'cover.jpg', blob }],
    });

    const result = await pickImageFromPhotoLibrary();

    expect(result.status).toBe('picked');
    if (result.status === 'picked') {
      expect(result.file.type).toBe('image/jpeg');
    }
  });

  it('returns cancelled when native file fetch is not ok', async () => {
    isNativePlatformMock.mockReturnValue(true);
    convertFileSrcMock.mockReturnValue('capacitor://localhost/_capacitor_file_/cover.jpg');
    pickImagesMock.mockResolvedValue({
      files: [{ name: 'cover.jpg', mimeType: 'image/jpeg', path: '/picked/cover.jpg' }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        blob: () => Promise.resolve(new Blob()),
      })
    );

    await expect(pickImageFromPhotoLibrary()).resolves.toEqual({ status: 'cancelled' });
  });

  it('returns cancelled when native file fetch fails', async () => {
    isNativePlatformMock.mockReturnValue(true);
    convertFileSrcMock.mockReturnValue('capacitor://localhost/_capacitor_file_/cover.jpg');
    pickImagesMock.mockResolvedValue({
      files: [{ name: 'cover.jpg', mimeType: 'image/jpeg', path: '/picked/cover.jpg' }],
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    await expect(pickImageFromPhotoLibrary()).resolves.toEqual({ status: 'cancelled' });
  });

  it('uses blob mime type when picked mime type is missing', async () => {
    isNativePlatformMock.mockReturnValue(true);
    convertFileSrcMock.mockReturnValue('capacitor://localhost/_capacitor_file_/cover.jpg');
    pickImagesMock.mockResolvedValue({
      files: [{ name: 'cover.jpg', path: '/picked/cover.jpg' }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['image-bytes'], { type: 'image/jpeg' })),
      })
    );

    const result = await pickImageFromPhotoLibrary();

    expect(result.status).toBe('picked');
    if (result.status === 'picked') {
      expect(result.file.type).toBe('image/jpeg');
    }
  });

  it('returns cancelled when File constructor is unavailable', async () => {
    isNativePlatformMock.mockReturnValue(true);
    const blob = new Blob(['image-bytes'], { type: 'image/jpeg' });
    pickImagesMock.mockResolvedValue({
      files: [{ name: 'cover.jpg', mimeType: 'image/jpeg', blob }],
    });
    vi.stubGlobal('File', undefined);

    await expect(pickImageFromPhotoLibrary()).resolves.toEqual({ status: 'cancelled' });
  });

  it('returns cancelled when File constructor throws', async () => {
    isNativePlatformMock.mockReturnValue(true);
    const blob = new Blob(['image-bytes'], { type: 'image/jpeg' });
    pickImagesMock.mockResolvedValue({
      files: [{ name: 'cover.jpg', mimeType: 'image/jpeg', blob }],
    });
    vi.stubGlobal('File', function ThrowingFile() {
      throw new Error('File not supported');
    });

    await expect(pickImageFromPhotoLibrary()).resolves.toEqual({ status: 'cancelled' });
  });
});
