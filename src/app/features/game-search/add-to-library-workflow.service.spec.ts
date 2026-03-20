import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertController, ToastController } from '@ionic/angular/standalone';

import { AddToLibraryWorkflowService } from './add-to-library-workflow.service';
import { GameShelfService } from '../../core/services/game-shelf.service';
import { PlatformOrderService } from '../../core/services/platform-order.service';
import { PlatformCustomizationService } from '../../core/services/platform-customization.service';
import type { GameCatalogResult } from '../../core/models/game.models';

describe('AddToLibraryWorkflowService', () => {
  let service: AddToLibraryWorkflowService;
  let alertController: { create: ReturnType<typeof vi.fn> };

  const duplicateAlert = {
    present: vi.fn().mockResolvedValue(undefined),
  };
  const choosePlatformAlert = {
    present: vi.fn().mockResolvedValue(undefined),
    onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel' }),
  };
  const toast = {
    present: vi.fn().mockResolvedValue(undefined),
  };
  const gameShelfService = {
    findGameByIdentity: vi.fn(),
    addGame: vi.fn(),
    searchBoxArtByTitle: vi.fn(() => of([])),
    shouldUseIgdbCoverForPlatform: vi.fn(() => false),
  };
  const platformOrderService = {
    comparePlatformNames: vi.fn((left: string, right: string) => left.localeCompare(right)),
  };
  const platformCustomizationService = {
    getDisplayNameWithoutAlias: vi.fn((name: string | null | undefined) => name ?? ''),
  };
  const toastController = {
    create: vi.fn().mockResolvedValue(toast),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    gameShelfService.findGameByIdentity.mockResolvedValue(null);
    gameShelfService.addGame.mockImplementation((catalog: GameCatalogResult) =>
      Promise.resolve({
        id: 1,
        title: catalog.title,
        platform: catalog.platform,
        platformId: catalog.platformIgdbId,
      })
    );
    alertController = {
      create: vi.fn((options?: { header?: string }) =>
        Promise.resolve(
          options?.header === 'Choose platform' ? choosePlatformAlert : duplicateAlert
        )
      ),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: GameShelfService, useValue: gameShelfService },
        { provide: PlatformOrderService, useValue: platformOrderService },
        { provide: PlatformCustomizationService, useValue: platformCustomizationService },
        { provide: AlertController, useValue: alertController },
        { provide: ToastController, useValue: toastController },
      ],
    });

    service = TestBed.runInInjectionContext(() => new AddToLibraryWorkflowService());
  });

  function makeResult(overrides: Partial<GameCatalogResult> = {}): GameCatalogResult {
    return {
      igdbGameId: '100',
      title: 'Metroid Prime',
      coverUrl: null,
      coverSource: 'igdb',
      platforms: ['Nintendo GameCube', 'PlayStation 2'],
      platformOptions: [
        { id: 21, name: 'Nintendo GameCube' },
        { id: 8, name: 'PlayStation 2' },
      ],
      platform: null,
      platformIgdbId: null,
      releaseDate: '2002-11-17T00:00:00.000Z',
      releaseYear: 2002,
      ...overrides,
    };
  }

  it('uses the preferred platform context without prompting when it matches an option', async () => {
    const result = makeResult();

    const addResult = await service.addToLibrary(result, 'collection', {
      preferredPlatformIgdbId: 21,
    });

    expect(alertController.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ header: 'Choose platform' })
    );
    expect(gameShelfService.findGameByIdentity).toHaveBeenCalledWith('100', 21);
    expect(gameShelfService.addGame).toHaveBeenCalledWith(
      expect.objectContaining({
        igdbGameId: '100',
        platform: 'Nintendo GameCube',
        platformIgdbId: 21,
      }),
      'collection'
    );
    expect(addResult.status).toBe('added');
  });

  it('still prompts when the preferred platform is not available in the result options', async () => {
    const result = makeResult();

    const addResult = await service.addToLibrary(result, 'collection', {
      preferredPlatformIgdbId: 999,
    });

    expect(alertController.create).toHaveBeenCalledWith(
      expect.objectContaining({ header: 'Choose platform' })
    );
    expect(addResult).toEqual({ status: 'cancelled' });
    expect(gameShelfService.addGame).not.toHaveBeenCalled();
  });
});
