import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugLogService } from './debug-log.service';
import { NetworkConnectivityService } from './network-connectivity.service';
import { isNativePlatform } from '../utils/native-platform.util';

const { nativeLogSpy } = vi.hoisted(() => ({
  nativeLogSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../plugins/native-logger.plugin', () => ({
  NativeLogger: {
    log: nativeLogSpy,
    exportLogs: vi.fn().mockResolvedValue({ content: '' }),
    clearLogs: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: vi.fn().mockReturnValue(false),
  getNativePlatform: vi.fn().mockReturnValue('web'),
}));

const connectivityListeners = new Set<(connected: boolean) => void>();
const networkConnectivityMock = {
  initialize: vi.fn(),
  isConnected: vi.fn(() => true),
  onConnectedChange: vi.fn((listener: (connected: boolean) => void) => {
    connectivityListeners.add(listener);
    return () => {
      connectivityListeners.delete(listener);
    };
  }),
};

describe('DebugLogService', () => {
  let service: DebugLogService;

  beforeEach(() => {
    localStorage.clear();
    connectivityListeners.clear();
    networkConnectivityMock.onConnectedChange.mockReset();
    networkConnectivityMock.onConnectedChange.mockImplementation(
      (listener: (connected: boolean) => void) => {
        connectivityListeners.add(listener);
        return () => {
          connectivityListeners.delete(listener);
        };
      }
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DebugLogService,
        { provide: NetworkConnectivityService, useValue: networkConnectivityMock },
      ],
    });
    service = TestBed.inject(DebugLogService);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    nativeLogSpy.mockClear();
  });

  it('logs network.online when connectivity reports connected', () => {
    service.initialize();

    connectivityListeners.forEach((listener) => {
      listener(true);
    });

    expect(service.exportText()).toContain('network.online');
  });

  it('logs network.offline when connectivity reports disconnected', () => {
    service.initialize();

    connectivityListeners.forEach((listener) => {
      listener(false);
    });

    expect(service.exportText()).toContain('network.offline');
  });

  it('registers the connectivity listener only once when initialize is called repeatedly', () => {
    service.initialize();
    service.initialize();

    expect(networkConnectivityMock.onConnectedChange).toHaveBeenCalledOnce();
  });

  it('flush calls NativeLogger.log with js.flush_checkpoint when on native', () => {
    vi.mocked(isNativePlatform).mockReturnValue(true);
    service.initialize();

    service.flush();

    expect(nativeLogSpy).toHaveBeenCalledWith({ level: 'info', message: 'js.flush_checkpoint' });
  });

  it('flush does not call NativeLogger.log when not on native', () => {
    vi.mocked(isNativePlatform).mockReturnValue(false);
    service.initialize();

    service.flush();

    expect(nativeLogSpy).not.toHaveBeenCalled();
  });
});
