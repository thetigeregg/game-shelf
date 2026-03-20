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
  let alertController: { create: ReturnType<typeof vi.fn> };

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
    alertController = {
      create: vi.fn(),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: GameShelfService, useValue: gameShelfService },
        { provide: PlatformOrderService, useValue: platformOrderService },
        { provide: PlatformCustomizationService, useValue: platformCustomizationService },
        { provide: AlertController, useValue: alertController },
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

    component.requestDetail(undefined, result);
    component.enableDetailNavigation = true;
    component.requestDetail(undefined, result);

    expect(emitSpy).toHaveBeenCalledOnce();
    expect(emitSpy).toHaveBeenCalledWith(result);
  });

  it('resolves a concrete platform before emitting a detail request without prompting', () => {
    const emitSpy = vi.fn();
    const result = makeResult({
      platform: null,
      platformIgdbId: null,
      platformOptions: [
        { id: 11, name: 'Xbox' },
        { id: 21, name: 'Nintendo GameCube' },
        { id: 8, name: 'PlayStation 2' },
      ],
      platforms: ['Xbox', 'Nintendo GameCube', 'PlayStation 2'],
    });
    platformOrderService.comparePlatformNames.mockImplementation((left: string, right: string) =>
      left.localeCompare(right)
    );
    component.enableDetailNavigation = true;
    component.detailRequested.subscribe(emitSpy);

    component.requestDetail(undefined, result);

    expect(alertController.create).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledOnce();
    expect(emitSpy).toHaveBeenCalledWith({
      ...result,
      platform: 'Nintendo GameCube',
      platformIgdbId: 21,
    });
  });

  it('stops propagation and triggers add action from the row button', async () => {
    const result = makeResult();
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    const addGameSpy = vi.spyOn(component, 'addGame').mockResolvedValue(undefined);

    component.onActionButtonClick({ stopPropagation, preventDefault } as unknown as Event, result);
    await Promise.resolve();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(addGameSpy).toHaveBeenCalledOnce();
    expect(addGameSpy).toHaveBeenCalledWith(result);
  });

  it('ignores row detail clicks that originate from nested buttons', () => {
    const emitSpy = vi.fn();
    const result = makeResult();
    const button = document.createElement('button');
    component.enableDetailNavigation = true;
    component.detailRequested.subscribe(emitSpy);

    component.requestDetail({ target: button } as Event, result);

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('keeps detail navigation disabled by default', () => {
    expect(component.enableDetailNavigation).toBe(false);
  });
});
