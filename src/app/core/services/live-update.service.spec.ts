import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { DebugLogService } from './debug-log.service';
import { LiveUpdateService } from './live-update.service';

const isNativePlatformMock = vi.fn<() => boolean>();
const liveUpdateReadyMock = vi.fn<
  [],
  Promise<{
    currentBundleId: string | null;
    previousBundleId: string | null;
    rollback: boolean;
  }>
>();
const liveUpdateGetVersionCodeMock = vi.fn<[], Promise<{ versionCode: string }>>();
const liveUpdateGetCurrentBundleMock = vi.fn<[], Promise<{ bundleId: string | null }>>();
const liveUpdateGetNextBundleMock = vi.fn<[], Promise<{ bundleId: string | null }>>();
const liveUpdateDownloadBundleMock = vi.fn<[unknown], Promise<void>>();
const liveUpdateSetNextBundleMock = vi.fn<[unknown], Promise<void>>();
const liveUpdateReloadMock = vi.fn<[], Promise<void>>();
const appAddListenerMock = vi.fn<
  [string, (state: { isActive: boolean }) => void],
  Promise<{ remove: () => void }>
>();

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock('@capawesome/capacitor-live-update', () => ({
  LiveUpdate: {
    ready: () => liveUpdateReadyMock(),
    getVersionCode: () => liveUpdateGetVersionCodeMock(),
    getCurrentBundle: () => liveUpdateGetCurrentBundleMock(),
    getNextBundle: () => liveUpdateGetNextBundleMock(),
    downloadBundle: (options: unknown) => liveUpdateDownloadBundleMock(options),
    setNextBundle: (options: unknown) => liveUpdateSetNextBundleMock(options),
    reload: () => liveUpdateReloadMock(),
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (eventName: string, listener: (state: { isActive: boolean }) => void) =>
      appAddListenerMock(eventName, listener),
  },
}));

const validManifest = {
  bundleId: 'v1.57.0-b42',
  semver: '1.57.0',
  nativeBuildNumber: '42',
  url: 'https://games.example.com/ota/ios/42/v1.57.0-b42.zip',
  checksum: 'abc',
  signature: 'sig',
};

describe('LiveUpdateService', () => {
  let service: LiveUpdateService;
  let debugLogService: DebugLogService;
  let originalProduction: boolean;
  let originalGameApiBaseUrl: string;
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalProduction = environment.production;
    originalGameApiBaseUrl = environment.gameApiBaseUrl;
    originalFetch = globalThis.fetch;

    isNativePlatformMock.mockReturnValue(true);
    environment.production = true;
    environment.gameApiBaseUrl = 'https://games.example.com/api';

    liveUpdateReadyMock.mockReset();
    liveUpdateGetVersionCodeMock.mockReset();
    liveUpdateGetCurrentBundleMock.mockReset();
    liveUpdateGetNextBundleMock.mockReset();
    liveUpdateDownloadBundleMock.mockReset();
    liveUpdateSetNextBundleMock.mockReset();
    liveUpdateReloadMock.mockReset();
    appAddListenerMock.mockReset();

    liveUpdateReadyMock.mockResolvedValue({
      currentBundleId: 'current',
      previousBundleId: null,
      rollback: false,
    });
    liveUpdateGetVersionCodeMock.mockResolvedValue({ versionCode: '42' });
    liveUpdateGetCurrentBundleMock.mockResolvedValue({ bundleId: null });
    liveUpdateGetNextBundleMock.mockResolvedValue({ bundleId: null });
    liveUpdateDownloadBundleMock.mockResolvedValue(undefined);
    liveUpdateSetNextBundleMock.mockResolvedValue(undefined);
    liveUpdateReloadMock.mockResolvedValue(undefined);
    appAddListenerMock.mockResolvedValue({ remove: () => undefined });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [LiveUpdateService, DebugLogService],
    });
    service = TestBed.inject(LiveUpdateService);
    debugLogService = TestBed.inject(DebugLogService);
    debugLogService.initialize();
  });

  afterEach(() => {
    environment.production = originalProduction;
    environment.gameApiBaseUrl = originalGameApiBaseUrl;
    if (originalFetch === undefined) {
      Reflect.deleteProperty(globalThis, 'fetch');
    } else {
      globalThis.fetch = originalFetch;
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('no-ops when live updates are disabled on web', async () => {
    isNativePlatformMock.mockReturnValue(false);

    await service.checkAndStageUpdate(true);
    await service.markReady();

    service.initializeResumeChecks();

    expect(liveUpdateGetVersionCodeMock).not.toHaveBeenCalled();
    expect(liveUpdateReadyMock).not.toHaveBeenCalled();
    expect(appAddListenerMock).not.toHaveBeenCalled();
  });

  it('no-ops when live updates are disabled outside production', async () => {
    environment.production = false;

    await service.checkAndStageUpdate(true);
    await service.markReady();

    service.initializeResumeChecks();

    expect(liveUpdateGetVersionCodeMock).not.toHaveBeenCalled();
    expect(liveUpdateReadyMock).not.toHaveBeenCalled();
    expect(appAddListenerMock).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent checks unless forced', async () => {
    let resolveResponse: ((value: Response) => void) | undefined;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn(() => fetchPromise);
    globalThis.fetch = fetchMock;

    const firstCheck = service.checkAndStageUpdate();
    const secondCheck = service.checkAndStageUpdate();

    resolveResponse?.(
      new Response(JSON.stringify(validManifest), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await Promise.all([firstCheck, secondCheck]);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight check before starting a forced check', async () => {
    let resolveResponse: ((value: Response) => void) | undefined;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn(() => fetchPromise);
    globalThis.fetch = fetchMock;

    const inFlightCheck = service.checkAndStageUpdate();
    const forcedCheck = service.checkAndStageUpdate(true);

    resolveResponse?.(
      new Response(JSON.stringify(validManifest), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await Promise.all([inFlightCheck, forcedCheck]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('markReady logs success and failure paths', async () => {
    await service.markReady();

    expect(liveUpdateReadyMock).toHaveBeenCalledOnce();
    expect(debugLogService.exportText()).toContain('live_update.ready');

    liveUpdateReadyMock.mockRejectedValueOnce(new Error('ready failed'));
    await service.markReady();

    expect(debugLogService.exportText()).toContain('live_update.ready_failed');
  });

  it('attaches a resume listener once and triggers checks when active', async () => {
    let resumeListener: ((state: { isActive: boolean }) => void) | undefined;
    appAddListenerMock.mockImplementation(
      (_eventName: string, listener: (state: { isActive: boolean }) => void) => {
        resumeListener = listener;
        return Promise.resolve({ remove: () => undefined });
      }
    );

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validManifest), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    service.initializeResumeChecks();
    service.initializeResumeChecks();

    expect(appAddListenerMock).toHaveBeenCalledOnce();

    resumeListener?.({ isActive: false });
    expect(globalThis.fetch).not.toHaveBeenCalled();

    resumeListener?.({ isActive: true });
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledOnce();
    });
  });

  it('logs when the resume listener cannot be attached', async () => {
    appAddListenerMock.mockRejectedValueOnce(new Error('listener failed'));

    service.initializeResumeChecks();

    await vi.waitFor(() => {
      expect(debugLogService.exportText()).toContain('live_update.resume_listener_failed');
    });
  });

  it('skips checks when version code or backend origin are missing', async () => {
    liveUpdateGetVersionCodeMock.mockResolvedValueOnce({ versionCode: '   ' });
    await service.checkAndStageUpdate(true);
    expect(debugLogService.exportText()).toContain('live_update.skip_missing_version_code');

    environment.gameApiBaseUrl = '';
    await service.checkAndStageUpdate(true);
    expect(debugLogService.exportText()).toContain('live_update.skip_missing_backend_origin');
  });

  it('skips staging when manifest is missing or invalid', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ bundleId: 'incomplete' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await service.checkAndStageUpdate(true);
    expect(debugLogService.exportText()).toContain('live_update.manifest_missing');
    expect(liveUpdateGetCurrentBundleMock).not.toHaveBeenCalled();
    expect(liveUpdateGetNextBundleMock).not.toHaveBeenCalled();

    await service.checkAndStageUpdate(true);
    expect(debugLogService.exportText()).toContain('live_update.manifest_invalid');
    expect(liveUpdateDownloadBundleMock).not.toHaveBeenCalled();
    expect(liveUpdateGetCurrentBundleMock).not.toHaveBeenCalled();
    expect(liveUpdateGetNextBundleMock).not.toHaveBeenCalled();
  });

  it('skips staging when manifest response is not valid JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html>error</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    await service.checkAndStageUpdate(true);

    expect(debugLogService.exportText()).toContain('live_update.manifest_invalid');
    expect(debugLogService.exportText()).not.toContain('live_update.check_failed');
    expect(liveUpdateDownloadBundleMock).not.toHaveBeenCalled();
    expect(liveUpdateGetCurrentBundleMock).not.toHaveBeenCalled();
    expect(liveUpdateGetNextBundleMock).not.toHaveBeenCalled();
  });

  it('skips staging when manifest is already active or staged', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validManifest), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    liveUpdateGetCurrentBundleMock.mockResolvedValueOnce({ bundleId: 'v1.57.0-b42' });

    await service.checkAndStageUpdate(true);

    expect(debugLogService.exportText()).toContain('live_update.skip');
    expect(liveUpdateDownloadBundleMock).not.toHaveBeenCalled();
  });

  it('downloads and stages a compatible manifest', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validManifest), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await service.checkAndStageUpdate(true);

    expect(liveUpdateDownloadBundleMock).toHaveBeenCalledWith({
      url: validManifest.url,
      bundleId: validManifest.bundleId,
      checksum: validManifest.checksum,
      signature: validManifest.signature,
    });
    expect(liveUpdateSetNextBundleMock).toHaveBeenCalledWith({ bundleId: validManifest.bundleId });
    expect(debugLogService.exportText()).toContain('live_update.staged');
  });

  it('respects the resume check interval unless forced', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validManifest), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await service.checkAndStageUpdate(true);
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    await service.checkAndStageUpdate();
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    await service.checkAndStageUpdate();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('logs check failures without throwing', async () => {
    liveUpdateGetVersionCodeMock.mockRejectedValueOnce(new Error('version lookup failed'));

    await expect(service.checkAndStageUpdate(true)).resolves.toBeUndefined();
    expect(debugLogService.exportText()).toContain('live_update.check_failed');
  });

  it('emits on staged$ when a bundle is staged', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validManifest), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const emissions: { semver: string }[] = [];
    service.staged$.subscribe((value) => emissions.push(value));

    await service.checkAndStageUpdate(true);

    expect(emissions).toEqual([{ semver: validManifest.semver }]);
  });

  it('does not emit on staged$ when staging is skipped', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validManifest), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    liveUpdateGetCurrentBundleMock.mockResolvedValueOnce({ bundleId: validManifest.bundleId });

    const emissions: { semver: string }[] = [];
    service.staged$.subscribe((value) => emissions.push(value));

    await service.checkAndStageUpdate(true);

    expect(emissions).toHaveLength(0);
  });

  it('reload calls LiveUpdate.reload and logs success', async () => {
    await service.reload();

    expect(liveUpdateReloadMock).toHaveBeenCalledOnce();
    expect(debugLogService.exportText()).toContain('live_update.reload');
  });

  it('reload is a no-op when disabled', async () => {
    isNativePlatformMock.mockReturnValue(false);

    await service.reload();

    expect(liveUpdateReloadMock).not.toHaveBeenCalled();
  });

  it('reload logs failure without throwing', async () => {
    liveUpdateReloadMock.mockRejectedValueOnce(new Error('reload failed'));

    await expect(service.reload()).resolves.toBeUndefined();
    expect(debugLogService.exportText()).toContain('live_update.reload_failed');
  });
});
