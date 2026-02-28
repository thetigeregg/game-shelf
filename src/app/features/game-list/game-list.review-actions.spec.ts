import { describe, expect, it, vi } from 'vitest';
import type { GameEntry } from '../../core/models/game.models';

vi.mock('@ionic/angular/standalone', () => {
  const Stub = () => null;
  return {
    AlertController: Stub,
    IonItemSliding: Stub,
    LoadingController: Stub,
    PopoverController: Stub,
    ToastController: Stub,
    IonList: Stub,
    IonListHeader: Stub,
    IonItem: Stub,
    IonLabel: Stub,
    IonAccordionGroup: Stub,
    IonAccordion: Stub,
    IonIcon: Stub,
    IonBadge: Stub,
    IonItemOptions: Stub,
    IonItemOption: Stub,
    IonPopover: Stub,
    IonContent: Stub,
    IonModal: Stub,
    IonHeader: Stub,
    IonToolbar: Stub,
    IonTitle: Stub,
    IonButtons: Stub,
    IonButton: Stub,
    IonSelect: Stub,
    IonSelectOption: Stub,
    IonSearchbar: Stub,
    IonSpinner: Stub,
    IonGrid: Stub,
    IonRow: Stub,
    IonCol: Stub,
    IonText: Stub,
    IonRange: Stub,
    IonNote: Stub,
    IonThumbnail: Stub,
    IonFab: Stub,
    IonFabButton: Stub,
    IonFabList: Stub,
    IonInput: Stub,
    IonMenu: Stub,
    IonSplitPane: Stub
  };
});

vi.mock('ionicons', () => ({ addIcons: vi.fn() }));
vi.mock('ionicons/icons', () => ({
  star: {},
  ellipsisHorizontal: {},
  close: {},
  closeCircle: {},
  starOutline: {},
  play: {},
  trashBin: {},
  trophy: {},
  bookmark: {},
  pause: {},
  refresh: {},
  globe: {},
  search: {},
  logoGoogle: {},
  logoYoutube: {},
  chevronBack: {},
  documentText: {},
  book: {}
}));
vi.mock('ngx-tiptap', () => ({
  TiptapEditorDirective: class {
    value = true;
  }
}));
vi.mock('@tiptap/core', () => ({
  Editor: class {
    value = true;
  }
}));
vi.mock('@tiptap/starter-kit', () => ({ default: {} }));
vi.mock('@tiptap/extension-underline', () => ({ default: {} }));
vi.mock('@tiptap/extension-list', () => ({ TaskItem: {}, TaskList: {} }));
vi.mock('@tiptap/extension-details', () => ({
  Details: {},
  DetailsContent: {},
  DetailsSummary: {}
}));

import { GameListComponent } from './game-list.component';

function createGame(partial: Partial<GameEntry> = {}): GameEntry {
  const now = new Date().toISOString();
  return {
    igdbGameId: partial.igdbGameId ?? '1',
    title: partial.title ?? 'Test Game',
    coverUrl: partial.coverUrl ?? null,
    coverSource: partial.coverSource ?? 'none',
    platform: partial.platform ?? 'Unknown',
    platformIgdbId: partial.platformIgdbId ?? 999999,
    releaseDate: partial.releaseDate ?? null,
    releaseYear: partial.releaseYear ?? null,
    listType: partial.listType ?? 'collection',
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    reviewScore: partial.reviewScore ?? null,
    metacriticScore: partial.metacriticScore ?? null
  };
}

describe('game-list review actions', () => {
  it('bulk review update processes all selected platforms with review copy', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      displayedGames: GameEntry[];
      selectedGameKeys: Set<string>;
    };
    const unsupported = createGame({
      igdbGameId: '1',
      platformIgdbId: 999999,
      title: 'Old Console'
    });
    const supported = createGame({ igdbGameId: '2', platformIgdbId: 6, title: 'PC Game' });
    const runBulkAction = vi.fn().mockResolvedValue([
      { game: unsupported, ok: true, value: createGame({ igdbGameId: '1', reviewScore: 91 }) },
      { game: supported, ok: false, value: null }
    ]);
    const clearSelectionMode = vi.fn();
    const presentToast = vi.fn(() => Promise.resolve(undefined));

    Object.assign(page, {
      displayedGames: [unsupported, supported],
      selectedGameKeys: new Set(['1::999999', '2::6']),
      runBulkAction,
      clearSelectionMode,
      presentToast
    });

    await (
      page as unknown as { updateReviewForSelectedGames: () => Promise<void> }
    ).updateReviewForSelectedGames();

    const firstCall = runBulkAction.mock.calls[0] as [GameEntry[]];
    expect(firstCall[0].map((game) => game.igdbGameId)).toEqual(['1', '2']);
    expect(presentToast).toHaveBeenCalledWith('Updated review data for 1 game.');
    expect(presentToast).toHaveBeenCalledWith(
      'Unable to update review data for 1 selected game.',
      'danger'
    );
    expect(clearSelectionMode).toHaveBeenCalledOnce();
  });

  it('single review refresh allows unsupported legacy platforms and uses review messages', async () => {
    const page = Object.create(GameListComponent.prototype) as GameListComponent & {
      selectedGame: GameEntry | null;
      isMetacriticUpdateLoading: boolean;
    };
    const target = createGame({ igdbGameId: '7', platformIgdbId: 999999, title: 'Saturn Title' });
    const loading = {
      present: vi.fn(() => Promise.resolve(undefined)),
      dismiss: vi.fn(() => Promise.resolve(undefined))
    };
    const refreshGameMetacriticScore = vi.fn(() =>
      Promise.resolve(createGame({ igdbGameId: '7', platformIgdbId: 999999, reviewScore: 84 }))
    );
    const presentToast = vi.fn(() => Promise.resolve(undefined));
    const applyUpdatedGame = vi.fn();

    Object.assign(page, {
      selectedGame: target,
      isMetacriticUpdateLoading: false,
      loadingController: { create: vi.fn(() => Promise.resolve(loading)) },
      gameShelfService: { refreshGameMetacriticScore },
      presentToast,
      applyUpdatedGame,
      openReviewPickerModal: vi.fn()
    });

    await (
      page as unknown as { refreshSelectedGameReviewScore: () => Promise<void> }
    ).refreshSelectedGameReviewScore();

    expect(refreshGameMetacriticScore).toHaveBeenCalledWith('7', 999999);
    expect(presentToast).toHaveBeenCalledWith('Review data updated.');
    expect(presentToast).not.toHaveBeenCalledWith(
      'Metacritic is not supported for this platform.',
      'warning'
    );
    expect((page as { isMetacriticUpdateLoading: boolean }).isMetacriticUpdateLoading).toBe(false);
  });
});
