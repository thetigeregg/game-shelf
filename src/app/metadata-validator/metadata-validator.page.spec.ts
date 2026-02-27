import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import type { GameEntry } from '../core/models/game.models';

vi.mock('@ionic/angular/standalone', () => {
  const Stub = () => null;

  return {
    IonBackButton: Stub,
    IonBadge: Stub,
    IonButton: Stub,
    IonButtons: Stub,
    IonCheckbox: Stub,
    IonContent: Stub,
    IonHeader: Stub,
    IonItem: Stub,
    IonLabel: Stub,
    IonList: Stub,
    IonListHeader: Stub,
    IonModal: Stub,
    IonNote: Stub,
    IonSearchbar: Stub,
    IonSelect: Stub,
    IonSelectOption: Stub,
    IonSpinner: Stub,
    IonThumbnail: Stub,
    IonTitle: Stub,
    IonToolbar: Stub,
    LoadingController: Stub,
    ToastController: Stub
  };
});

import { MetadataValidatorPage } from './metadata-validator.page';

function createGame(partial: Partial<GameEntry> = {}): GameEntry {
  const now = new Date().toISOString();
  return {
    igdbGameId: partial.igdbGameId ?? '1',
    title: partial.title ?? 'Test Game',
    coverUrl: partial.coverUrl ?? null,
    coverSource: partial.coverSource ?? 'none',
    platform: partial.platform ?? 'PC',
    platformIgdbId: partial.platformIgdbId ?? 6,
    releaseDate: partial.releaseDate ?? null,
    releaseYear: partial.releaseYear ?? 1993,
    listType: partial.listType ?? 'collection',
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now
  };
}

function createPageHarness(): MetadataValidatorPage {
  const page = Object.create(MetadataValidatorPage.prototype) as MetadataValidatorPage;
  (page as unknown as { metacriticPickerQuery: string }).metacriticPickerQuery = '';
  (page as unknown as { metacriticPickerTargetGame: GameEntry | null }).metacriticPickerTargetGame =
    null;
  (page as unknown as { metacriticPickerResults: unknown[] }).metacriticPickerResults = [];
  (page as unknown as { metacriticPickerError: string | null }).metacriticPickerError = null;
  (page as unknown as { isMetacriticPickerLoading: boolean }).isMetacriticPickerLoading = false;
  return page;
}

describe('MetadataValidatorPage metacritic flows', () => {
  it('blocks row-level metacritic picker for unsupported platforms', async () => {
    const page = createPageHarness();
    const presentToast = vi.fn(() => Promise.resolve(undefined));
    const openPicker = vi.fn(() => Promise.resolve(undefined));
    (page as unknown as { presentToast: typeof presentToast }).presentToast = presentToast;
    (
      page as unknown as { openMetacriticPickerModal: typeof openPicker }
    ).openMetacriticPickerModal = openPicker;

    await page.refreshMetacriticForGame(createGame({ platformIgdbId: 999999, platform: 'Saturn' }));

    expect(openPicker).not.toHaveBeenCalled();
    expect(presentToast).toHaveBeenCalledWith(
      'Metacritic is not supported for this platform.',
      'warning'
    );
  });

  it('opens row-level metacritic picker for supported platforms', async () => {
    const page = createPageHarness();
    const presentToast = vi.fn(() => Promise.resolve(undefined));
    const openPicker = vi.fn(() => Promise.resolve(undefined));
    const game = createGame({ platformIgdbId: 167, platform: 'PlayStation 5' });
    (page as unknown as { presentToast: typeof presentToast }).presentToast = presentToast;
    (
      page as unknown as { openMetacriticPickerModal: typeof openPicker }
    ).openMetacriticPickerModal = openPicker;

    await page.refreshMetacriticForGame(game);

    expect(openPicker).toHaveBeenCalledWith(game);
    expect(presentToast).not.toHaveBeenCalled();
  });

  it('uses target game context when searching metacritic picker candidates', async () => {
    const page = createPageHarness();
    const search = vi.fn(() => of([]));
    (
      page as unknown as { gameShelfService: { searchMetacriticCandidates: typeof search } }
    ).gameShelfService = { searchMetacriticCandidates: search };
    (page as unknown as { metacriticPickerQuery: string }).metacriticPickerQuery = '  doom  ';
    (
      page as unknown as { metacriticPickerTargetGame: GameEntry | null }
    ).metacriticPickerTargetGame = createGame({
      releaseYear: 1993,
      platform: 'PC',
      platformIgdbId: 6
    });

    await page.runMetacriticPickerSearch();

    expect(search).toHaveBeenCalledWith('doom', 1993, 'PC', 6);
  });
});
