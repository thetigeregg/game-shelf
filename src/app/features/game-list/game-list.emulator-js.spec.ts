import { describe, expect, it, vi } from 'vitest';
import { EMULATORJS_DEFAULT_PATH_TO_DATA } from '../../core/config/emulatorjs.constants';
import type { GameEntry } from '../../core/models/game.models';
import { GameListComponent } from './game-list.component';

type ToastControllerMock = {
  create: ReturnType<typeof vi.fn>;
};

type ChangeDetectorRefMock = {
  markForCheck: ReturnType<typeof vi.fn>;
};

function makeGame(overrides: Partial<GameEntry> = {}): GameEntry {
  return {
    id: 1,
    igdbGameId: '1',
    title: 'Test Game',
    platform: 'Sony PlayStation',
    platformIgdbId: 7,
    listType: 'collection',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as GameEntry;
}

function makeHarness(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  const toast = { present: vi.fn().mockResolvedValue(undefined) };
  const toastController: ToastControllerMock = {
    create: vi.fn().mockResolvedValue(toast),
  };
  const changeDetectorRef: ChangeDetectorRefMock = {
    markForCheck: vi.fn(),
  };
  return {
    selectedGame: makeGame(),
    romResolvedUrl: '/roms/Sony%20PlayStation__pid-7/Test%20Game.bin',
    platformCustomizationService: {
      resolveCanonicalPlatformIgdbId: vi.fn().mockReturnValue(7),
    },
    getGameDisplayPlatform: vi
      .fn()
      .mockReturnValue({ name: 'Sony PlayStation', igdbId: 7 } as { name: string; igdbId: number }),
    presentEmulatorUnsupportedToast: vi.fn().mockResolvedValue(undefined),
    toastController,
    changeDetectorRef,
    emulatorJsLaunchUrl: null,
    isEmulatorJsModalOpen: false,
    ...overrides,
  };
}

describe('GameListComponent emulator launch flow', () => {
  it('opens emulator modal with assembled launch URL for a supported platform', async () => {
    const harness = makeHarness();

    await GameListComponent.prototype.openRomInEmulator.call(
      harness as unknown as GameListComponent
    );

    expect(harness.isEmulatorJsModalOpen).toBe(true);
    expect(typeof harness.emulatorJsLaunchUrl).toBe('string');
    expect(
      (harness.changeDetectorRef as ChangeDetectorRefMock).markForCheck
    ).toHaveBeenCalledOnce();

    const launchUrl = new URL(String(harness.emulatorJsLaunchUrl));
    expect(launchUrl.pathname).toBe('/assets/emulatorjs/play.html');
    expect(launchUrl.searchParams.get('core')).toBe('psx');
    expect(launchUrl.searchParams.get('title')).toBe('Test Game');
    expect(launchUrl.searchParams.get('debug')).toBe('1');
    expect(launchUrl.searchParams.get('shader')).toBe('crt-geom.glslp');
    expect(launchUrl.searchParams.get('rom')).toBe(
      `${window.location.origin}/roms/Sony%20PlayStation__pid-7/Test%20Game.bin`
    );
    expect(launchUrl.searchParams.get('pathtodata')).toBe(EMULATORJS_DEFAULT_PATH_TO_DATA);
    expect(launchUrl.searchParams.get('loader_integrity')).toBeTruthy();
    expect(launchUrl.searchParams.get('bios')).toBe(
      `${window.location.origin}/bios/psx/psx-bios.zip`
    );
  });

  it('shows unsupported toast path when canonical platform id is missing', async () => {
    const harness = makeHarness({
      platformCustomizationService: {
        resolveCanonicalPlatformIgdbId: vi.fn().mockReturnValue(null),
      },
    });

    await GameListComponent.prototype.openRomInEmulator.call(
      harness as unknown as GameListComponent
    );

    expect(harness.presentEmulatorUnsupportedToast).toHaveBeenCalledOnce();
    expect(harness.isEmulatorJsModalOpen).toBe(false);
    expect(harness.emulatorJsLaunchUrl).toBeNull();
  });

  it('shows error toast when launch URL assembly throws', async () => {
    const harness = makeHarness({
      romResolvedUrl: 'http://[invalid-host',
    });
    const toast = { present: vi.fn().mockResolvedValue(undefined) };
    (harness.toastController as ToastControllerMock).create = vi.fn().mockResolvedValue(toast);

    await GameListComponent.prototype.openRomInEmulator.call(
      harness as unknown as GameListComponent
    );

    expect((harness.toastController as ToastControllerMock).create).toHaveBeenCalledWith({
      message: 'Unable to start the emulator.',
      duration: 2800,
      color: 'danger',
    });
    expect(toast.present).toHaveBeenCalledOnce();
    expect(harness.isEmulatorJsModalOpen).toBe(false);
  });

  it('closes emulator modal and clears launch URL', () => {
    const harness = makeHarness({
      emulatorJsLaunchUrl: 'https://app.test/assets/emulatorjs/play.html?core=nes',
      isEmulatorJsModalOpen: true,
    });

    GameListComponent.prototype.closeEmulatorJsModal.call(harness as unknown as GameListComponent);

    expect(harness.isEmulatorJsModalOpen).toBe(false);
    expect(harness.emulatorJsLaunchUrl).toBeNull();
    expect(
      (harness.changeDetectorRef as ChangeDetectorRefMock).markForCheck
    ).toHaveBeenCalledOnce();
  });
});

describe('GameListComponent ROM UI vs EmulatorJS platform map', () => {
  /** IGDB 5 (Wii) is on the manual shortcut whitelist but has no EmulatorJS core mapping. */
  function wiiHarness(): Record<string, unknown> {
    return {
      isSimilarDiscoveryDetailModalOpen: false,
      selectedGame: makeGame({ platform: 'Wii', platformIgdbId: 5 }),
      romResolvedUrl: '/roms/Wii__pid-5/Test%20Game.iso',
      romCatalogUnavailable: false,
      romResolvedSource: null,
      platformCustomizationService: {
        resolveCanonicalPlatformIgdbId: vi.fn().mockReturnValue(5),
      },
      getGameDisplayPlatform: vi
        .fn()
        .mockReturnValue({ name: 'Wii', igdbId: 5 } as { name: string; igdbId: number }),
    };
  }

  type RomGateProto = {
    canShowRomButtonsForGame(this: GameListComponent, game: GameEntry): boolean;
  };

  it('does not treat manual-whitelist-only platforms as ROM-capable (EmulatorJS map gate)', () => {
    const harness = wiiHarness();
    const game = harness.selectedGame as GameEntry;
    const result = (
      GameListComponent.prototype as unknown as RomGateProto
    ).canShowRomButtonsForGame.call(harness as unknown as GameListComponent, game);
    expect(result).toBe(false);
  });
});
