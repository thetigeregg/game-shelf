import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonNote,
  IonSearchbar,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonThumbnail,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular/standalone';
import { BehaviorSubject, combineLatest, firstValueFrom, of } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { GameEntry, HltbMatchCandidate, ListType } from '../core/models/game.models';
import { GameShelfService } from '../core/services/game-shelf.service';

type MissingMetadataFilter = 'hltb' | 'nonPcTheGamesDbImage';

@Component({
  selector: 'app-metadata-validator',
  templateUrl: './metadata-validator.page.html',
  styleUrls: ['./metadata-validator.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonBackButton,
    IonBadge,
    IonButton,
    IonButtons,
    IonCheckbox,
    IonContent,
    IonHeader,
    IonItem,
    IonLabel,
    IonList,
    IonListHeader,
    IonModal,
    IonNote,
    IonSearchbar,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonThumbnail,
    IonTitle,
    IonToolbar,
  ],
})
export class MetadataValidatorPage {
  readonly missingFilterOptions: Array<{ value: MissingMetadataFilter; label: string }> = [
    { value: 'hltb', label: 'Missing HLTB' },
    { value: 'nonPcTheGamesDbImage', label: 'Missing TheGamesDB image (non-PC)' },
  ];

  selectedListType: ListType | null = null;
  selectedMissingFilters: MissingMetadataFilter[] = [];
  selectedGameKeys = new Set<string>();
  isBulkRefreshingHltb = false;
  isBulkRefreshingImage = false;
  isHltbPickerModalOpen = false;
  isHltbPickerLoading = false;
  hltbPickerQuery = '';
  hltbPickerResults: HltbMatchCandidate[] = [];
  hltbPickerError: string | null = null;
  hltbPickerTargetGame: GameEntry | null = null;
  private displayedGames: GameEntry[] = [];
  private readonly selectedListType$ = new BehaviorSubject<ListType | null>(null);
  private readonly selectedMissingFilters$ = new BehaviorSubject<MissingMetadataFilter[]>([]);
  private readonly gameShelfService = inject(GameShelfService);
  private readonly toastController = inject(ToastController);
  private readonly router = inject(Router);

  readonly filteredGames$ = combineLatest([
    this.selectedListType$.pipe(
      switchMap(listType => (listType ? this.gameShelfService.watchList(listType) : of([]))),
    ),
    this.selectedMissingFilters$,
  ]).pipe(
    map(([games, filters]) => this.applyMissingMetadataFilters(games, filters)),
    tap(games => {
      this.displayedGames = games;
      this.syncSelectionToDisplayedGames();
    }),
  );

  onListTypeChange(value: ListType | string | null | undefined): void {
    const next = value === 'collection' || value === 'wishlist' ? value : null;
    this.selectedListType = next;
    this.selectedListType$.next(next);
    this.selectedGameKeys.clear();
  }

  onMissingFiltersChange(value: MissingMetadataFilter[] | MissingMetadataFilter | string[] | string | null | undefined): void {
    const raw = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
    const normalized = raw
      .filter((entry): entry is MissingMetadataFilter => entry === 'hltb' || entry === 'nonPcTheGamesDbImage');
    this.selectedMissingFilters = [...new Set(normalized)];
    this.selectedMissingFilters$.next(this.selectedMissingFilters);
  }

  trackByGameKey(_: number, game: GameEntry): string {
    return `${game.igdbGameId}::${game.platformIgdbId}`;
  }

  getDisplayedGamesLabel(): string {
    return this.displayedGames.length === 1 ? '1 game' : `${this.displayedGames.length} games`;
  }

  isGameSelected(game: GameEntry): boolean {
    return this.selectedGameKeys.has(this.getGameKey(game));
  }

  get selectedGamesCount(): number {
    return this.selectedGameKeys.size;
  }

  isAllDisplayedSelected(): boolean {
    return this.displayedGames.length > 0 && this.selectedGameKeys.size === this.displayedGames.length;
  }

  toggleSelectAllDisplayed(): void {
    if (this.displayedGames.length === 0) {
      return;
    }

    if (this.isAllDisplayedSelected()) {
      this.selectedGameKeys.clear();
      return;
    }

    this.selectedGameKeys = new Set(this.displayedGames.map(game => this.getGameKey(game)));
  }

  toggleGameSelection(game: GameEntry): void {
    const key = this.getGameKey(game);

    if (this.selectedGameKeys.has(key)) {
      this.selectedGameKeys.delete(key);
      return;
    }

    this.selectedGameKeys.add(key);
  }

  clearSelection(): void {
    this.selectedGameKeys.clear();
  }

  hasHltbMetadata(game: GameEntry): boolean {
    return this.toPositiveNumber(game.hltbMainHours) !== null
      || this.toPositiveNumber(game.hltbMainExtraHours) !== null
      || this.toPositiveNumber(game.hltbCompletionistHours) !== null;
  }

  isNonPcTheGamesDbImagePresent(game: GameEntry): boolean {
    if (this.isPcPlatform(game)) {
      return false;
    }

    return game.coverSource === 'thegamesdb'
      && typeof game.coverUrl === 'string'
      && game.coverUrl.trim().length > 0;
  }

  isNonPcImageNotApplicable(game: GameEntry): boolean {
    return this.isPcPlatform(game);
  }

  async refreshHltbForGame(game: GameEntry): Promise<void> {
    await this.openHltbPickerModal(game);
  }

  async refreshImageForGame(game: GameEntry): Promise<void> {
    if (this.isPcPlatform(game)) {
      await this.presentToast('Image validation is not required for PC games.', 'warning');
      return;
    }

    try {
      const candidates = await firstValueFrom(
        this.gameShelfService.searchBoxArtByTitle(game.title, game.platform, game.platformIgdbId, game.igdbGameId),
      );
      const coverUrl = candidates[0];

      if (!coverUrl) {
        await this.presentToast(`No TheGamesDB image found for ${game.title}.`, 'warning');
        return;
      }

      await this.gameShelfService.updateGameCover(game.igdbGameId, game.platformIgdbId, coverUrl, 'thegamesdb');
      await this.presentToast(`Updated image for ${game.title}.`);
    } catch {
      await this.presentToast(`Unable to update image for ${game.title}.`, 'danger');
    }
  }

  async refreshHltbForSelectedGames(): Promise<void> {
    const games = this.getSelectedGames();

    if (games.length === 0 || this.isBulkRefreshingHltb) {
      return;
    }

    this.isBulkRefreshingHltb = true;

    try {
      await Promise.all(games.map(game => this.gameShelfService.refreshGameCompletionTimes(game.igdbGameId, game.platformIgdbId)));
      await this.presentToast(`Updated HLTB for ${games.length} game${games.length === 1 ? '' : 's'}.`);
    } catch {
      await this.presentToast('Unable to update HLTB for selected games.', 'danger');
    } finally {
      this.isBulkRefreshingHltb = false;
    }
  }

  async refreshImageForSelectedGames(): Promise<void> {
    const games = this.getSelectedGames().filter(game => !this.isPcPlatform(game));

    if (games.length === 0 || this.isBulkRefreshingImage) {
      return;
    }

    this.isBulkRefreshingImage = true;

    try {
      let updatedCount = 0;

      for (const game of games) {
        const candidates = await firstValueFrom(
          this.gameShelfService.searchBoxArtByTitle(game.title, game.platform, game.platformIgdbId, game.igdbGameId),
        );
        const coverUrl = candidates[0];

        if (!coverUrl) {
          continue;
        }

        await this.gameShelfService.updateGameCover(game.igdbGameId, game.platformIgdbId, coverUrl, 'thegamesdb');
        updatedCount += 1;
      }

      if (updatedCount === 0) {
        await this.presentToast('No TheGamesDB image updates were available.', 'warning');
        return;
      }

      await this.presentToast(`Updated images for ${updatedCount} game${updatedCount === 1 ? '' : 's'}.`);
    } catch {
      await this.presentToast('Unable to update images for selected games.', 'danger');
    } finally {
      this.isBulkRefreshingImage = false;
    }
  }

  goToSettings(): void {
    void this.router.navigateByUrl('/settings');
  }

  closeHltbPickerModal(): void {
    this.isHltbPickerModalOpen = false;
    this.isHltbPickerLoading = false;
    this.hltbPickerQuery = '';
    this.hltbPickerResults = [];
    this.hltbPickerError = null;
    this.hltbPickerTargetGame = null;
  }

  onHltbPickerQueryChange(event: Event): void {
    const customEvent = event as CustomEvent<{ value?: string | null }>;
    this.hltbPickerQuery = String(customEvent.detail?.value ?? '');
  }

  async runHltbPickerSearch(): Promise<void> {
    const normalized = this.hltbPickerQuery.trim();

    if (normalized.length < 2) {
      this.hltbPickerResults = [];
      this.hltbPickerError = 'Enter at least 2 characters.';
      return;
    }

    this.isHltbPickerLoading = true;
    this.hltbPickerError = null;

    try {
      const candidates = await firstValueFrom(this.gameShelfService.searchHltbCandidates(normalized, null, null));
      this.hltbPickerResults = this.dedupeHltbCandidates(candidates).slice(0, 30);
    } catch {
      this.hltbPickerResults = [];
      this.hltbPickerError = 'Unable to search HLTB right now.';
    } finally {
      this.isHltbPickerLoading = false;
    }
  }

  async applySelectedHltbCandidate(candidate: HltbMatchCandidate): Promise<void> {
    const target = this.hltbPickerTargetGame;

    if (!target) {
      return;
    }

    this.isHltbPickerLoading = true;

    try {
      await this.gameShelfService.refreshGameCompletionTimesWithQuery(
        target.igdbGameId,
        target.platformIgdbId,
        {
          title: candidate.title,
          releaseYear: candidate.releaseYear,
          platform: candidate.platform,
        },
      );
      this.closeHltbPickerModal();
      await this.presentToast(`Updated HLTB for ${target.title}.`);
    } catch {
      this.isHltbPickerLoading = false;
      await this.presentToast(`Unable to update HLTB for ${target.title}.`, 'danger');
    }
  }

  async useOriginalHltbLookup(): Promise<void> {
    const target = this.hltbPickerTargetGame;

    if (!target) {
      return;
    }

    this.isHltbPickerLoading = true;

    try {
      await this.gameShelfService.refreshGameCompletionTimes(target.igdbGameId, target.platformIgdbId);
      this.closeHltbPickerModal();
      await this.presentToast(`Updated HLTB for ${target.title}.`);
    } catch {
      this.isHltbPickerLoading = false;
      await this.presentToast(`Unable to update HLTB for ${target.title}.`, 'danger');
    }
  }

  private applyMissingMetadataFilters(games: GameEntry[], filters: MissingMetadataFilter[]): GameEntry[] {
    if (filters.length === 0) {
      return games;
    }

    return games.filter(game => {
      const missingHltb = !this.hasHltbMetadata(game);
      const missingImage = this.isMissingNonPcTheGamesDbImage(game);

      return (filters.includes('hltb') && missingHltb)
        || (filters.includes('nonPcTheGamesDbImage') && missingImage);
    });
  }

  private isPcPlatform(game: GameEntry): boolean {
    return this.gameShelfService.shouldUseIgdbCoverForPlatform(game.platform, game.platformIgdbId);
  }

  private isMissingNonPcTheGamesDbImage(game: GameEntry): boolean {
    if (this.isPcPlatform(game)) {
      return false;
    }

    return !this.isNonPcTheGamesDbImagePresent(game);
  }

  private getSelectedGames(): GameEntry[] {
    return this.displayedGames.filter(game => this.selectedGameKeys.has(this.getGameKey(game)));
  }

  private syncSelectionToDisplayedGames(): void {
    const displayedKeys = new Set(this.displayedGames.map(game => this.getGameKey(game)));
    this.selectedGameKeys.forEach(key => {
      if (!displayedKeys.has(key)) {
        this.selectedGameKeys.delete(key);
      }
    });
  }

  private getGameKey(game: GameEntry): string {
    return `${game.igdbGameId}::${game.platformIgdbId}`;
  }

  private toPositiveNumber(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return value;
  }

  private async openHltbPickerModal(game: GameEntry): Promise<void> {
    this.hltbPickerTargetGame = game;
    this.hltbPickerQuery = game.title;
    this.hltbPickerResults = [];
    this.hltbPickerError = null;
    this.isHltbPickerLoading = false;
    this.isHltbPickerModalOpen = true;
    await this.runHltbPickerSearch();
  }

  private dedupeHltbCandidates(candidates: HltbMatchCandidate[]): HltbMatchCandidate[] {
    const byKey = new Map<string, HltbMatchCandidate>();

    candidates.forEach(candidate => {
      const key = `${candidate.title}::${candidate.releaseYear ?? ''}::${candidate.platform ?? ''}`;

      if (!byKey.has(key)) {
        byKey.set(key, candidate);
      }
    });

    return [...byKey.values()];
  }

  private async presentToast(message: string, color: 'primary' | 'danger' | 'warning' = 'primary'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 1600,
      position: 'bottom',
      color,
    });

    await toast.present();
  }
}
