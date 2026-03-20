import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertController } from '@ionic/angular/standalone';

import { GameSearchComponent } from './game-search.component';
import { GameShelfService } from '../../core/services/game-shelf.service';
import { PlatformOrderService } from '../../core/services/platform-order.service';
import { PlatformCustomizationService } from '../../core/services/platform-customization.service';
import { AddToLibraryWorkflowService } from './add-to-library-workflow.service';
import type { GameCatalogResult, GameCatalogPlatformOption } from '../../core/models/game.models';

describe('GameSearchComponent', () => {
  let component: GameSearchComponent;
  let addToLibraryWorkflow: { addToLibrary: ReturnType<typeof vi.fn> };

  const gameShelfService = {
    listSearchPlatforms: vi.fn(() => of([])),
    searchGames: vi.fn(() => of([])),
    findGameByIdentity: vi.fn(),
    searchBoxArtByTitle: vi.fn(() => of([])),
    shouldUseIgdbCoverForPlatform: vi.fn(() => false),
  };
  const platformOrderService = {
    sortPlatformOptionsByCustomOrder: vi.fn((platforms: GameCatalogPlatformOption[]) => platforms),
    sortPlatformOptions: vi.fn((platforms: GameCatalogPlatformOption[]) => platforms),
    comparePlatformNames: vi.fn(() => 0),
  };
  const platformCustomizationService = {
    getDisplayNameWithoutAlias: vi.fn((name: string | null | undefined) => name ?? ''),
  };

  beforeEach(() => {
    addToLibraryWorkflow = {
      addToLibrary: vi.fn().mockResolvedValue({ status: 'added' }),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: GameShelfService, useValue: gameShelfService },
        { provide: PlatformOrderService, useValue: platformOrderService },
        { provide: PlatformCustomizationService, useValue: platformCustomizationService },
        { provide: AlertController, useValue: { create: vi.fn() } },
        { provide: AddToLibraryWorkflowService, useValue: addToLibraryWorkflow },
        { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new GameSearchComponent());
    component.listType = 'collection';
  });

  function makeResult(overrides: Partial<GameCatalogResult> = {}): GameCatalogResult {
    return {
      igdbGameId: '100',
      title: 'Metroid Prime',
      coverUrl: null,
      coverSource: 'igdb',
      platforms: ['GameCube'],
      platformOptions: [{ id: 21, name: 'GameCube' }],
      platform: 'GameCube',
      platformIgdbId: 21,
      releaseDate: '2002-11-17T00:00:00.000Z',
      releaseYear: 2002,
      ...overrides,
    };
  }

  it('emits detail requests only when detail navigation is enabled', () => {
    const emitSpy = vi.fn();
    const result = makeResult();
    component.detailRequested.subscribe(emitSpy);

    component.requestDetail(result);
    component.enableDetailNavigation = true;
    component.requestDetail(result);

    expect(emitSpy).toHaveBeenCalledOnce();
    expect(emitSpy).toHaveBeenCalledWith(result);
  });

  it('stops propagation and triggers add action from the row button', async () => {
    const result = makeResult();
    const stopPropagation = vi.fn();
    const addGameSpy = vi.spyOn(component, 'addGame').mockResolvedValue(undefined);

    component.onActionButtonClick({ stopPropagation } as unknown as Event, result);
    await Promise.resolve();

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(addGameSpy).toHaveBeenCalledOnce();
    expect(addGameSpy).toHaveBeenCalledWith(result);
  });

  it('keeps detail navigation disabled by default', () => {
    expect(component.enableDetailNavigation).toBe(false);
  });
});
