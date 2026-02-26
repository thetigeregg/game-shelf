import { Component, OnInit, inject } from '@angular/core';
import {
  AlertController,
  ToastController,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonSelect,
  IonSelectOption,
  IonButton,
  IonButtons,
  IonLoading,
  IonSpinner,
  IonTitle,
  IonToolbar,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonText,
  IonFab,
  IonFabButton,
  IonFabList,
  IonIcon
} from '@ionic/angular/standalone';
import { firstValueFrom } from 'rxjs';
import { IgdbProxyService } from '../core/api/igdb-proxy.service';
import {
  GameCatalogResult,
  GameEntry,
  GameRating,
  GameStatus,
  ListType,
  PopularityGameResult,
  PopularityTypeOption
} from '../core/models/game.models';
import { PlatformCustomizationService } from '../core/services/platform-customization.service';
import { GameDetailContentComponent } from '../features/game-detail/game-detail-content.component';
import { AddToLibraryWorkflowService } from '../features/game-search/add-to-library-workflow.service';
import { GameShelfService } from '../core/services/game-shelf.service';
import {
  buildTagInput,
  normalizeGameRating,
  normalizeGameStatus,
  parseTagSelection
} from '../features/game-list/game-list-detail-actions';
import { addIcons } from 'ionicons';
import { search, logoGoogle, logoYoutube } from 'ionicons/icons';

@Component({
  selector: 'app-explore-page',
  templateUrl: './explore.page.html',
  styleUrls: ['./explore.page.scss'],
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonItem,
    IonLabel,
    IonModal,
    IonSelect,
    IonSelectOption,
    IonButton,
    IonButtons,
    IonLoading,
    IonSpinner,
    IonList,
    IonInfiniteScroll,
    IonInfiniteScrollContent,
    IonText,
    IonFab,
    IonFabButton,
    IonFabList,
    IonIcon,
    GameDetailContentComponent
  ]
})
export class ExplorePage implements OnInit {
  private static readonly PAGE_SIZE = 20;

  popularityTypes: PopularityTypeOption[] = [];
  selectedPopularityTypeId: number | null = null;
  games: PopularityGameResult[] = [];
  isLoadingTypes = false;
  isLoadingGames = false;
  isLoadingMore = false;
  hasMore = false;
  errorMessage = '';
  isGameDetailModalOpen = false;
  isLoadingDetail = false;
  detailErrorMessage = '';
  selectedGameDetail: GameCatalogResult | GameEntry | null = null;
  detailContext: 'explore' | 'library' = 'explore';
  isSelectedGameInLibrary = false;
  isAddToLibraryLoading = false;
  readonly ratingOptions: GameRating[] = [1, 2, 3, 4, 5];
  readonly statusOptions: { value: GameStatus; label: string }[] = [
    { value: 'playing', label: 'Playing' },
    { value: 'wantToPlay', label: 'Want to Play' },
    { value: 'completed', label: 'Completed' },
    { value: 'paused', label: 'Paused' },
    { value: 'dropped', label: 'Dropped' },
    { value: 'replay', label: 'Replay' }
  ];

  private readonly igdbProxyService = inject(IgdbProxyService);
  private readonly platformCustomizationService = inject(PlatformCustomizationService);
  private readonly addToLibraryWorkflow = inject(AddToLibraryWorkflowService);
  private readonly gameShelfService = inject(GameShelfService);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private offset = 0;

  constructor() {
    addIcons({ search, logoGoogle, logoYoutube });
  }

  ngOnInit(): void {
    void this.loadPopularityTypes();
  }

  async onPopularityTypeChange(value: string | number | null | undefined): Promise<void> {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      this.selectedPopularityTypeId = value;
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
      const parsed = Number.parseInt(value, 10);
      this.selectedPopularityTypeId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } else {
      this.selectedPopularityTypeId = null;
    }

    this.offset = 0;
    this.games = [];
    this.hasMore = false;

    if (this.selectedPopularityTypeId !== null) {
      await this.loadGamesPage(false);
    }
  }

  async loadMore(event: Event): Promise<void> {
    if (this.selectedPopularityTypeId === null || this.isLoadingMore || !this.hasMore) {
      await this.completeInfiniteScroll(event);
      return;
    }

    this.isLoadingMore = true;

    try {
      await this.loadGamesPage(true);
    } finally {
      this.isLoadingMore = false;
      await this.completeInfiniteScroll(event);
    }
  }

  trackByPopularityTypeId(_: number, item: PopularityTypeOption): number {
    return item.id;
  }

  trackByGameId(index: number, item: PopularityGameResult): string {
    return `${item.game.igdbGameId}:${String(index)}`;
  }

  async openGameDetail(item: PopularityGameResult): Promise<void> {
    this.isGameDetailModalOpen = true;
    this.isLoadingDetail = true;
    this.detailErrorMessage = '';
    this.detailContext = 'explore';
    this.isSelectedGameInLibrary = false;
    this.isAddToLibraryLoading = false;
    this.selectedGameDetail = item.game;

    try {
      this.isSelectedGameInLibrary = await this.checkGameAlreadyInLibrary(item.game);
      const detail = await firstValueFrom(this.igdbProxyService.getGameById(item.game.igdbGameId));
      this.selectedGameDetail = detail;
      this.isSelectedGameInLibrary = await this.checkGameAlreadyInLibrary(detail);
    } catch (error) {
      this.detailErrorMessage =
        error instanceof Error ? error.message : 'Unable to load game details.';
    } finally {
      this.isLoadingDetail = false;
    }
  }

  closeGameDetailModal(): void {
    this.isGameDetailModalOpen = false;
    this.isLoadingDetail = false;
    this.detailErrorMessage = '';
    this.selectedGameDetail = null;
    this.detailContext = 'explore';
    this.isSelectedGameInLibrary = false;
    this.isAddToLibraryLoading = false;
  }

  async addSelectedGameToLibrary(): Promise<void> {
    if (
      this.detailContext !== 'explore' ||
      this.isSelectedGameInLibrary ||
      this.isAddToLibraryLoading ||
      !this.selectedGameDetail
    ) {
      return;
    }

    const listType = await this.pickListTypeForAdd();

    if (!listType) {
      return;
    }

    this.isAddToLibraryLoading = true;

    try {
      const addResult = await this.addToLibraryWorkflow.addToLibrary(
        this.selectedGameDetail as GameCatalogResult,
        listType
      );

      if (addResult.status === 'added' && addResult.entry) {
        this.selectedGameDetail = addResult.entry;
        this.detailContext = 'library';
        this.isSelectedGameInLibrary = true;
      } else if (addResult.status === 'duplicate') {
        this.isSelectedGameInLibrary = true;
      }
    } finally {
      this.isAddToLibraryLoading = false;
    }
  }

  async onDetailStatusChange(value: GameStatus | null | undefined): Promise<void> {
    const selected = this.selectedGameDetail;

    if (!this.isLibraryEntry(selected)) {
      return;
    }

    const normalized = normalizeGameStatus(value);

    try {
      const updated = await this.gameShelfService.setGameStatus(
        selected.igdbGameId,
        selected.platformIgdbId,
        normalized
      );
      this.selectedGameDetail = updated;
    } catch {
      await this.presentToast('Unable to update game status.', 'danger');
    }
  }

  async clearDetailStatus(): Promise<void> {
    const selected = this.selectedGameDetail;

    if (!this.isLibraryEntry(selected)) {
      return;
    }

    try {
      const updated = await this.gameShelfService.setGameStatus(
        selected.igdbGameId,
        selected.platformIgdbId,
        null
      );
      this.selectedGameDetail = updated;
      await this.presentToast('Game status cleared.');
    } catch {
      await this.presentToast('Unable to clear game status.', 'danger');
    }
  }

  async onDetailRatingChange(value: number | null | undefined): Promise<void> {
    const selected = this.selectedGameDetail;

    if (!this.isLibraryEntry(selected)) {
      return;
    }

    const normalized = normalizeGameRating(value);

    if (normalized === null) {
      return;
    }

    try {
      const updated = await this.gameShelfService.setGameRating(
        selected.igdbGameId,
        selected.platformIgdbId,
        normalized
      );
      this.selectedGameDetail = updated;
      await this.presentToast('Game rating updated.');
    } catch {
      await this.presentToast('Unable to update game rating.', 'danger');
    }
  }

  async clearDetailRating(): Promise<void> {
    const selected = this.selectedGameDetail;

    if (!this.isLibraryEntry(selected)) {
      return;
    }

    try {
      const updated = await this.gameShelfService.setGameRating(
        selected.igdbGameId,
        selected.platformIgdbId,
        null
      );
      this.selectedGameDetail = updated;
      await this.presentToast('Game rating cleared.');
    } catch {
      await this.presentToast('Unable to clear game rating.', 'danger');
    }
  }

  async openDetailTags(): Promise<void> {
    const selected = this.selectedGameDetail;

    if (!this.isLibraryEntry(selected)) {
      return;
    }

    const tags = await this.gameShelfService.listTags();

    if (tags.length === 0) {
      await this.presentToast('Create a tag first from the Tags page.');
      return;
    }

    const existingTagIds = Array.isArray(selected.tagIds)
      ? selected.tagIds.filter((id) => Number.isInteger(id) && id > 0)
      : [];
    let nextTagIds = existingTagIds;
    const alert = await this.alertController.create({
      header: 'Set Tags',
      message: `Update tags for ${selected.title}.`,
      inputs: tags.map((tag) => buildTagInput(tag, existingTagIds)),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Apply',
          role: 'confirm',
          handler: (value: string[] | string | null | undefined) => {
            nextTagIds = parseTagSelection(value);
          }
        }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return;
    }

    try {
      const updated = await this.gameShelfService.setGameTags(
        selected.igdbGameId,
        selected.platformIgdbId,
        nextTagIds
      );
      this.selectedGameDetail = updated;
      await this.presentToast('Tags updated.');
    } catch {
      await this.presentToast('Unable to update tags.', 'danger');
    }
  }

  openShortcutSearch(provider: 'google' | 'youtube' | 'wikipedia' | 'gamefaqs'): void {
    const query = this.selectedGameDetail?.title.trim();

    if (!query) {
      return;
    }

    const encodedQuery = encodeURIComponent(query);
    let url = '';

    if (provider === 'google') {
      url = `https://www.google.com/search?q=${encodedQuery}`;
    } else if (provider === 'youtube') {
      url = `https://www.youtube.com/results?search_query=${encodedQuery}`;
    } else if (provider === 'wikipedia') {
      url = `https://en.wikipedia.org/w/index.php?search=${encodedQuery}`;
    } else {
      url = `https://gamefaqs.gamespot.com/search?game=${encodedQuery}`;
    }

    this.openExternalUrl(url);
  }

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/placeholder.png';
    }
  }

  getPlatformLabel(item: PopularityGameResult): string {
    const platforms = this.getPlatformOptions(item.game);

    if (platforms.length === 0) {
      return 'Unknown platform';
    }

    if (platforms.length === 1) {
      return this.getPlatformDisplayName(platforms[0].name, platforms[0].id);
    }

    return `${String(platforms.length)} platforms`;
  }

  private getPlatformDisplayName(name: string, platformIgdbId: number | null): string {
    if (name.trim().length > 0) {
      const aliased = this.platformCustomizationService
        .getDisplayNameWithoutAlias(name, platformIgdbId)
        .trim();

      if (aliased.length > 0) {
        return aliased;
      }
    }

    return 'Unknown platform';
  }

  private async pickListTypeForAdd(): Promise<ListType | null> {
    let selected: ListType = 'collection';
    const alert = await this.alertController.create({
      header: 'Add to Library',
      message: 'Choose where to add this game.',
      inputs: [
        {
          type: 'radio',
          label: 'Collection',
          value: 'collection',
          checked: true
        },
        {
          type: 'radio',
          label: 'Wishlist',
          value: 'wishlist',
          checked: false
        }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Add',
          role: 'confirm',
          handler: (value: string) => {
            selected = value === 'wishlist' ? 'wishlist' : 'collection';
          }
        }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return null;
    }

    return selected;
  }

  private getPlatformOptions(
    game: GameCatalogResult | GameEntry
  ): { id: number | null; name: string }[] {
    const catalogLike = game as Partial<GameCatalogResult>;

    if (Array.isArray(catalogLike.platformOptions) && catalogLike.platformOptions.length > 0) {
      return catalogLike.platformOptions
        .map((option): { id: number | null; name: string } => {
          const name = typeof option.name === 'string' ? option.name.trim() : '';
          const id =
            Number.isInteger(option.id) && (option.id as number) > 0 ? (option.id as number) : null;
          return { id, name };
        })
        .filter((option: { id: number | null; name: string }) => option.name.length > 0)
        .filter(
          (
            option: { id: number | null; name: string },
            index: number,
            items: { id: number | null; name: string }[]
          ) => {
            return (
              items.findIndex(
                (candidate: { id: number | null; name: string }) =>
                  candidate.id === option.id && candidate.name === option.name
              ) === index
            );
          }
        );
    }

    if (Array.isArray(catalogLike.platforms) && catalogLike.platforms.length > 0) {
      return [
        ...new Set(
          catalogLike.platforms
            .map((platform) => (typeof platform === 'string' ? platform.trim() : ''))
            .filter((platform) => platform.length > 0)
        )
      ].map((name) => ({ id: null, name }));
    }

    if (typeof game.platform === 'string' && game.platform.trim().length > 0) {
      return [{ id: null, name: game.platform.trim() }];
    }

    return [];
  }

  private async checkGameAlreadyInLibrary(game: GameCatalogResult | GameEntry): Promise<boolean> {
    if (this.isLibraryEntry(game)) {
      return true;
    }

    const platformIgdbIds = this.collectPlatformIgdbIds(game);

    if (platformIgdbIds.length === 0) {
      return false;
    }

    for (const platformIgdbId of platformIgdbIds) {
      const existing = await this.gameShelfService.findGameByIdentity(
        game.igdbGameId,
        platformIgdbId
      );

      if (existing) {
        return true;
      }
    }

    return false;
  }

  private collectPlatformIgdbIds(game: GameCatalogResult | GameEntry): number[] {
    const ids = new Set<number>();
    const catalogLike = game as Partial<GameCatalogResult>;

    if (Number.isInteger(game.platformIgdbId) && (game.platformIgdbId as number) > 0) {
      ids.add(game.platformIgdbId as number);
    }

    if (Array.isArray(catalogLike.platformOptions)) {
      for (const option of catalogLike.platformOptions) {
        if (Number.isInteger(option.id) && (option.id as number) > 0) {
          ids.add(option.id as number);
        }
      }
    }

    return Array.from(ids);
  }

  private isLibraryEntry(value: GameCatalogResult | GameEntry | null): value is GameEntry {
    if (!value) {
      return false;
    }

    return (
      (value as GameEntry).listType === 'collection' || (value as GameEntry).listType === 'wishlist'
    );
  }

  private async presentToast(
    message: string,
    color: 'primary' | 'danger' = 'primary'
  ): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 1600,
      position: 'bottom',
      color
    });

    await toast.present();
  }

  private openExternalUrl(url: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer external';
    anchor.click();
  }

  private async loadPopularityTypes(): Promise<void> {
    this.isLoadingTypes = true;
    this.errorMessage = '';

    try {
      const types = await firstValueFrom(this.igdbProxyService.listPopularityTypes());
      this.popularityTypes = types;

      if (types.length > 0) {
        this.selectedPopularityTypeId = types[0].id;
        this.offset = 0;
        await this.loadGamesPage(false);
      }
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : 'Unable to load popularity categories.';
      this.popularityTypes = [];
      this.selectedPopularityTypeId = null;
      this.games = [];
      this.hasMore = false;
    } finally {
      this.isLoadingTypes = false;
    }
  }

  private async loadGamesPage(append: boolean): Promise<void> {
    if (this.selectedPopularityTypeId === null) {
      return;
    }

    if (!append) {
      this.isLoadingGames = true;
      this.errorMessage = '';
    }

    try {
      const items = await firstValueFrom(
        this.igdbProxyService.listPopularityGames(
          this.selectedPopularityTypeId,
          ExplorePage.PAGE_SIZE,
          this.offset
        )
      );

      this.games = append ? [...this.games, ...items] : items;
      this.offset += items.length;
      this.hasMore = items.length === ExplorePage.PAGE_SIZE;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Unable to load popular games.';
      this.hasMore = false;
    } finally {
      if (!append) {
        this.isLoadingGames = false;
      }
    }
  }

  private async completeInfiniteScroll(event: Event): Promise<void> {
    const target = event.target as HTMLIonInfiniteScrollElement | null;

    if (!target || typeof target.complete !== 'function') {
      return;
    }

    await target.complete();
  }
}
