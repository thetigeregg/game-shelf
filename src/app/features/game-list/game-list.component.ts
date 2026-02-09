import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { AlertController, PopoverController, ToastController } from '@ionic/angular';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import {
  DEFAULT_GAME_LIST_FILTERS,
  GameEntry,
  GameGroupByField,
  GameListFilters,
  ListType,
  Tag
} from '../../core/models/game.models';
import { GameShelfService } from '../../core/services/game-shelf.service';

interface GameGroupSection {
  key: string;
  title: string;
  games: GameEntry[];
}

interface GroupedGamesView {
  grouped: boolean;
  sections: GameGroupSection[];
  totalCount: number;
}

@Component({
  selector: 'app-game-list',
  templateUrl: './game-list.component.html',
  styleUrls: ['./game-list.component.scss'],
  standalone: false,
})
export class GameListComponent implements OnChanges {
  @Input({ required: true }) listType!: ListType;
  @Input() filters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
  @Input() searchQuery = '';
  @Input() groupBy: GameGroupByField = 'none';
  @Output() platformOptionsChange = new EventEmitter<string[]>();
  @Output() displayedGamesChange = new EventEmitter<GameEntry[]>();

  games$: Observable<GameEntry[]> = of([]);
  groupedView$: Observable<GroupedGamesView> = of({ grouped: false, sections: [], totalCount: 0 });
  isGameDetailModalOpen = false;
  isImagePickerModalOpen = false;
  selectedGame: GameEntry | null = null;
  imagePickerQuery = '';
  imagePickerResults: string[] = [];
  isImagePickerLoading = false;
  imagePickerError: string | null = null;
  private readonly gameShelfService = inject(GameShelfService);
  private readonly popoverController = inject(PopoverController);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private readonly filters$ = new BehaviorSubject<GameListFilters>({ ...DEFAULT_GAME_LIST_FILTERS });
  private readonly searchQuery$ = new BehaviorSubject<string>('');
  private readonly groupBy$ = new BehaviorSubject<GameGroupByField>('none');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['listType']?.currentValue) {
      const allGames$ = this.gameShelfService.watchList(this.listType).pipe(
        tap(games => {
          this.platformOptionsChange.emit(this.extractPlatforms(games));
        })
      );

      this.games$ = combineLatest([allGames$, this.filters$, this.searchQuery$]).pipe(
        map(([games, filters, searchQuery]) => this.applyFiltersAndSort(games, filters, searchQuery)),
        tap(games => {
          this.displayedGamesChange.emit(games);
        })
      );

      this.groupedView$ = combineLatest([this.games$, this.groupBy$]).pipe(
        map(([games, groupBy]) => this.buildGroupedView(games, groupBy))
      );
    }

    if (changes['filters']?.currentValue) {
      this.filters$.next(this.normalizeFilters(this.filters));
    }

    if (changes['searchQuery']) {
      this.searchQuery$.next((this.searchQuery ?? '').trim());
    }

    if (changes['groupBy']) {
      this.groupBy$.next(this.groupBy ?? 'none');
    }
  }

  async moveGame(game: GameEntry): Promise<void> {
    const targetList = this.getOtherListType();
    await this.gameShelfService.moveGame(game.externalId, targetList);
    await this.presentToast(`Moved to ${this.getListLabel(targetList)}.`);
  }

  async removeGame(game: GameEntry): Promise<void> {
    await this.gameShelfService.removeGame(game.externalId);
  }

  async moveGameFromPopover(game: GameEntry): Promise<void> {
    await this.moveGame(game);
    await this.popoverController.dismiss();
  }

  async removeGameFromPopover(game: GameEntry): Promise<void> {
    await this.removeGame(game);
    await this.popoverController.dismiss();
  }

  async openTagsForGameFromPopover(game: GameEntry): Promise<void> {
    await this.popoverController.dismiss();
    await this.openTagsPicker(game);
  }

  getOtherListLabel(): string {
    return this.listType === 'collection' ? 'Wishlist' : 'Collection';
  }

  openGameDetail(game: GameEntry): void {
    this.selectedGame = game;
    this.isGameDetailModalOpen = true;
    this.resetImagePickerState();
  }

  closeGameDetailModal(): void {
    this.isGameDetailModalOpen = false;
    this.isImagePickerModalOpen = false;
    this.selectedGame = null;
    this.resetImagePickerState();
  }

  getDetailActionsTriggerId(): string {
    return `game-detail-actions-trigger-${this.listType}`;
  }

  trackByExternalId(_: number, game: GameEntry): string {
    return game.externalId;
  }

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/favicon.png';
    }
  }

  getActionsTriggerId(game: GameEntry): string {
    return `game-actions-trigger-${game.externalId}`;
  }

  onActionsButtonClick(event: Event): void {
    event.stopPropagation();
  }

  async refreshSelectedGameMetadataFromPopover(): Promise<void> {
    await this.refreshSelectedGameMetadata();
    await this.popoverController.dismiss();
  }

  async openImagePickerFromPopover(): Promise<void> {
    await this.popoverController.dismiss();
    await this.openImagePickerModal();
  }

  async openSelectedGameTagsFromPopover(): Promise<void> {
    await this.popoverController.dismiss();

    if (!this.selectedGame) {
      return;
    }

    await this.openTagsPicker(this.selectedGame);
  }

  async openSelectedGameTagsFromDetail(): Promise<void> {
    if (!this.selectedGame) {
      return;
    }

    await this.openTagsPicker(this.selectedGame);
  }

  async refreshSelectedGameMetadata(): Promise<void> {
    if (!this.selectedGame) {
      return;
    }

    try {
      const updated = await this.gameShelfService.refreshGameMetadata(this.selectedGame.externalId);
      this.selectedGame = updated;
      await this.presentToast('Game metadata refreshed.');
    } catch {
      await this.presentToast('Unable to refresh game metadata.', 'danger');
    }
  }

  closeImagePickerModal(): void {
    this.isImagePickerModalOpen = false;
  }

  async runImagePickerSearch(): Promise<void> {
    const normalized = this.imagePickerQuery.trim();

    if (normalized.length < 2) {
      this.imagePickerResults = [];
      this.imagePickerError = null;
      return;
    }

    this.isImagePickerLoading = true;
    this.imagePickerError = null;

    try {
      this.imagePickerResults = await firstValueFrom(
        this.gameShelfService.searchBoxArtByTitle(
          normalized,
          this.selectedGame?.platform ?? null,
          this.selectedGame?.platformIgdbId ?? null,
        )
      );
    } catch {
      this.imagePickerResults = [];
      this.imagePickerError = 'Unable to load box art results.';
    } finally {
      this.isImagePickerLoading = false;
    }
  }

  onImagePickerQueryChange(event: Event): void {
    const customEvent = event as CustomEvent<{ value?: string }>;
    this.imagePickerQuery = (customEvent.detail?.value ?? '').replace(/^\s+/, '');
  }

  async applySelectedImage(url: string): Promise<void> {
    if (!this.selectedGame) {
      return;
    }

    try {
      const updated = await this.gameShelfService.updateGameCover(this.selectedGame.externalId, url);
      this.selectedGame = updated;
      this.closeImagePickerModal();
      await this.presentToast('Game image updated.');
    } catch {
      await this.presentToast('Unable to update game image.', 'danger');
    }
  }

  formatDate(value: string | null): string {
    if (!value) {
      return 'Unknown';
    }

    const timestamp = Date.parse(value);

    if (Number.isNaN(timestamp)) {
      return value;
    }

    return new Date(timestamp).toLocaleDateString();
  }

  getTagTextColor(color: string): string {
    const normalized = color.trim();

    if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      return '#ffffff';
    }

    const red = Number.parseInt(normalized.slice(1, 3), 16);
    const green = Number.parseInt(normalized.slice(3, 5), 16);
    const blue = Number.parseInt(normalized.slice(5, 7), 16);
    const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

    return luminance > 0.6 ? '#000000' : '#ffffff';
  }

  getExpandedGroupValues(sections: GameGroupSection[]): string[] {
    return sections.map(section => section.key);
  }

  getGroupCountLabel(count: number): string {
    return count === 1 ? '1 game' : `${count} games`;
  }

  private getOtherListType(): ListType {
    return this.listType === 'collection' ? 'wishlist' : 'collection';
  }

  private getListLabel(listType: ListType): string {
    return listType === 'collection' ? 'Collection' : 'Wishlist';
  }

  private normalizeFilters(filters: GameListFilters): GameListFilters {
    return {
      ...DEFAULT_GAME_LIST_FILTERS,
      ...filters,
    };
  }

  private extractPlatforms(games: GameEntry[]): string[] {
    return [...new Set(
      games
        .map(game => game.platform?.trim() ?? '')
        .filter(platform => platform.length > 0)
    )].sort((a, b) => a.localeCompare(b));
  }

  private applyFiltersAndSort(games: GameEntry[], filters: GameListFilters, searchQuery: string): GameEntry[] {
    const filtered = games.filter(game => this.matchesFilters(game, filters, searchQuery));
    return this.sortGames(filtered, filters);
  }

  private buildGroupedView(games: GameEntry[], groupBy: GameGroupByField): GroupedGamesView {
    if (groupBy === 'none') {
      return {
        grouped: false,
        sections: [{ key: 'none', title: 'All Games', games }],
        totalCount: games.length,
      };
    }

    const sectionsMap = new Map<string, GameEntry[]>();

    games.forEach(game => {
      this.getGroupTitlesForGame(game, groupBy).forEach(title => {
        const normalized = title.trim();

        if (!sectionsMap.has(normalized)) {
          sectionsMap.set(normalized, []);
        }

        sectionsMap.get(normalized)?.push(game);
      });
    });

    const sortedSections = [...sectionsMap.entries()]
      .sort(([left], [right]) => this.compareGroupTitles(left, right, groupBy))
      .map(([title, groupedGames]) => ({
        key: `${groupBy}-${title}`,
        title,
        games: groupedGames,
      }));

    return {
      grouped: true,
      sections: sortedSections,
      totalCount: games.length,
    };
  }

  private getGroupTitlesForGame(game: GameEntry, groupBy: GameGroupByField): string[] {
    if (groupBy === 'platform') {
      return [game.platform?.trim() || 'Unknown platform'];
    }

    if (groupBy === 'releaseYear') {
      return [game.releaseYear ? String(game.releaseYear) : 'Unknown year'];
    }

    if (groupBy === 'tag') {
      const tagNames = (game.tags ?? [])
        .map(tag => tag.name.trim())
        .filter(name => name.length > 0);

      return tagNames.length > 0 ? [...new Set(tagNames)] : ['No tags'];
    }

    if (groupBy === 'developer') {
      return this.getMetadataGroupValues(game.developers, 'Unknown developer');
    }

    if (groupBy === 'franchise') {
      return this.getMetadataGroupValues(game.franchises, 'Unknown franchise');
    }

    if (groupBy === 'genre') {
      return this.getMetadataGroupValues(game.genres, 'Unknown genre');
    }

    if (groupBy === 'publisher') {
      return this.getMetadataGroupValues(game.publishers, 'Unknown publisher');
    }

    return ['All Games'];
  }

  private getMetadataGroupValues(values: string[] | undefined, fallback: string): string[] {
    if (!Array.isArray(values)) {
      return [fallback];
    }

    const normalizedValues = [...new Set(
      values
        .map(value => (typeof value === 'string' ? value.trim() : ''))
        .filter(value => value.length > 0)
    )];

    return normalizedValues.length > 0 ? normalizedValues : [fallback];
  }

  private compareGroupTitles(left: string, right: string, groupBy: GameGroupByField): number {
    if (groupBy === 'releaseYear') {
      if (left === 'Unknown year' && right !== 'Unknown year') {
        return 1;
      }

      if (right === 'Unknown year' && left !== 'Unknown year') {
        return -1;
      }

      const leftYear = Number.parseInt(left, 10);
      const rightYear = Number.parseInt(right, 10);

      if (!Number.isNaN(leftYear) && !Number.isNaN(rightYear) && leftYear !== rightYear) {
        return rightYear - leftYear;
      }
    }

    return left.localeCompare(right, undefined, { sensitivity: 'base' });
  }

  private matchesFilters(game: GameEntry, filters: GameListFilters, searchQuery: string): boolean {
    if (searchQuery.length > 0 && !game.title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    if (filters.platform !== 'all' && game.platform !== filters.platform) {
      return false;
    }

    const gameDate = this.getDateOnly(game.releaseDate);

    if (filters.releaseDateFrom && (!gameDate || gameDate < filters.releaseDateFrom)) {
      return false;
    }

    if (filters.releaseDateTo && (!gameDate || gameDate > filters.releaseDateTo)) {
      return false;
    }

    return true;
  }

  private sortGames(games: GameEntry[], filters: GameListFilters): GameEntry[] {
    const sorted = [...games].sort((left, right) => this.compareGames(left, right, filters.sortField));
    return filters.sortDirection === 'desc' ? sorted.reverse() : sorted;
  }

  private compareGames(left: GameEntry, right: GameEntry, sortField: GameListFilters['sortField']): number {
    if (sortField === 'title') {
      return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
    }

    if (sortField === 'platform') {
      const leftPlatform = left.platform?.trim() || 'Unknown platform';
      const rightPlatform = right.platform?.trim() || 'Unknown platform';
      const platformCompare = leftPlatform.localeCompare(rightPlatform, undefined, { sensitivity: 'base' });

      if (platformCompare !== 0) {
        return platformCompare;
      }

      return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
    }

    if (sortField === 'createdAt') {
      const leftCreatedAt = Date.parse(left.createdAt);
      const rightCreatedAt = Date.parse(right.createdAt);
      const leftValid = Number.isNaN(leftCreatedAt) ? null : leftCreatedAt;
      const rightValid = Number.isNaN(rightCreatedAt) ? null : rightCreatedAt;

      if (leftValid !== null && rightValid !== null && leftValid !== rightValid) {
        return leftValid - rightValid;
      }

      if (leftValid !== null && rightValid === null) {
        return -1;
      }

      if (leftValid === null && rightValid !== null) {
        return 1;
      }

      return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
    }

    const leftDate = this.getDateOnly(left.releaseDate);
    const rightDate = this.getDateOnly(right.releaseDate);

    if (leftDate && rightDate) {
      return leftDate.localeCompare(rightDate);
    }

    if (leftDate) {
      return -1;
    }

    if (rightDate) {
      return 1;
    }

    return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
  }

  private getDateOnly(releaseDate: string | null): string | null {
    if (typeof releaseDate !== 'string' || releaseDate.length < 10) {
      return null;
    }

    return releaseDate.slice(0, 10);
  }

  private async presentToast(message: string, color: 'primary' | 'danger' = 'primary'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 1600,
      position: 'bottom',
      color,
    });

    await toast.present();
  }

  private async openImagePickerModal(): Promise<void> {
    if (!this.selectedGame) {
      return;
    }

    this.imagePickerQuery = this.selectedGame.title;
    this.imagePickerResults = [];
    this.imagePickerError = null;
    this.isImagePickerModalOpen = true;
    await this.runImagePickerSearch();
  }

  private async openTagsPicker(game: GameEntry): Promise<void> {
    const tags = await this.gameShelfService.listTags();

    if (tags.length === 0) {
      await this.presentToast('Create a tag first from the Tags page.', 'primary');
      return;
    }

    let nextTagIds = this.normalizeTagIds(game.tagIds);
    const alert = await this.alertController.create({
      header: 'Game Tags',
      message: `Select tags for ${game.title}.`,
      inputs: tags.map(tag => this.buildTagInput(tag, nextTagIds)),
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Save',
          role: 'confirm',
          handler: (value: string[] | string | null | undefined) => {
            nextTagIds = this.parseTagSelection(value);
          },
        },
      ],
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return;
    }

    const updated = await this.gameShelfService.setGameTags(game.externalId, nextTagIds);

    if (this.selectedGame?.externalId === updated.externalId) {
      this.selectedGame = updated;
    }

    await this.presentToast('Tags updated.');
  }

  private buildTagInput(tag: Tag, selectedTagIds: number[]): { type: 'checkbox'; label: string; value: string; checked: boolean } {
    const tagId = typeof tag.id === 'number' && Number.isInteger(tag.id) && tag.id > 0 ? tag.id : -1;

    return {
      type: 'checkbox',
      label: tag.name,
      value: String(tagId),
      checked: selectedTagIds.includes(tagId),
    };
  }

  private parseTagSelection(value: string[] | string | null | undefined): number[] {
    if (Array.isArray(value)) {
      return this.normalizeTagIds(value.map(entry => Number.parseInt(entry, 10)));
    }

    if (typeof value === 'string') {
      return this.normalizeTagIds([Number.parseInt(value, 10)]);
    }

    return [];
  }

  private normalizeTagIds(tagIds: number[] | undefined): number[] {
    if (!Array.isArray(tagIds)) {
      return [];
    }

    return [...new Set(
      tagIds
        .filter(tagId => Number.isInteger(tagId) && tagId > 0)
        .map(tagId => Math.trunc(tagId))
    )];
  }

  private resetImagePickerState(): void {
    this.imagePickerQuery = '';
    this.imagePickerResults = [];
    this.imagePickerError = null;
    this.isImagePickerLoading = false;
  }
}
