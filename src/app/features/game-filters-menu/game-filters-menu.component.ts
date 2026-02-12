import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
    IonMenu,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonMenuToggle,
    IonButton,
    IonContent,
    IonList,
    IonItem,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonLabel,
    IonDatetimeButton,
    IonModal,
    IonDatetime
} from '@ionic/angular/standalone';
import {
    DEFAULT_GAME_LIST_FILTERS,
    GameGroupByField,
    GameListFilters,
    GameRatingFilterOption,
    GameStatusFilterOption,
    GameType,
} from '../../core/models/game.models';
import {
    normalizeGameRatingFilterList,
    normalizeGameStatusFilterList,
    normalizeGameTypeList,
    normalizeStringList,
} from '../../core/utils/game-filter-utils';

type SortOption =
    | 'title:asc'
    | 'title:desc'
    | 'releaseDate:asc'
    | 'releaseDate:desc'
    | 'createdAt:asc'
    | 'createdAt:desc'
    | 'platform:asc'
    | 'platform:desc';

@Component({
    selector: 'app-game-filters-menu',
    templateUrl: './game-filters-menu.component.html',
    styleUrls: ['./game-filters-menu.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        IonMenu,
        IonHeader,
        IonToolbar,
        IonTitle,
        IonButtons,
        IonMenuToggle,
        IonButton,
        IonContent,
        IonList,
        IonItem,
        IonInput,
        IonSelect,
        IonSelectOption,
        IonLabel,
        IonDatetimeButton,
        IonModal,
        IonDatetime,
    ],
})
export class GameFiltersMenuComponent implements OnChanges {
    readonly noneTagFilterValue = '__none__';
    readonly statusOptions: GameStatusFilterOption[] = ['none', 'playing', 'wantToPlay', 'completed', 'paused', 'dropped', 'replay'];
    readonly ratingOptions: GameRatingFilterOption[] = ['none', 1, 2, 3, 4, 5];
    readonly groupByOptions: { value: GameGroupByField; label: string }[] = [
        { value: 'none', label: 'None' },
        { value: 'platform', label: 'Platform' },
        { value: 'developer', label: 'Developer' },
        { value: 'franchise', label: 'Franchise' },
        { value: 'collection', label: 'Series' },
        { value: 'tag', label: 'Tag' },
        { value: 'genre', label: 'Genre' },
        { value: 'publisher', label: 'Publisher' },
        { value: 'releaseYear', label: 'Release Year' },
    ];

    @Input({ required: true }) menuId!: string;
    @Input({ required: true }) contentId!: string;
    @Input() platformOptions: string[] = [];
    @Input() collectionOptions: string[] = [];
    @Input() gameTypeOptions: GameType[] = [];
    @Input() genreOptions: string[] = [];
    @Input() tagOptions: string[] = [];
    @Input() filters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
    @Input() groupBy: GameGroupByField = 'none';

    @Output() filtersChange = new EventEmitter<GameListFilters>();
    @Output() groupByChange = new EventEmitter<GameGroupByField>();

    draftFilters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
    sortOption: SortOption = 'title:asc';

    ngOnChanges(): void {
        this.draftFilters = {
            ...DEFAULT_GAME_LIST_FILTERS,
            ...this.filters,
        };
        this.sortOption = `${this.draftFilters.sortField}:${this.draftFilters.sortDirection}` as SortOption;
    }

    updateFilters(): void {
        this.filtersChange.emit({ ...this.draftFilters });
    }

    resetFilters(): void {
        this.draftFilters = { ...DEFAULT_GAME_LIST_FILTERS };
        this.sortOption = 'title:asc';
        this.updateFilters();
        this.groupByChange.emit('none');
    }

    onSortOptionChange(value: SortOption | string): void {
        if (!this.isSortOption(value)) {
            return;
        }

        const [sortField, sortDirection] = value.split(':') as [GameListFilters['sortField'], GameListFilters['sortDirection']];
        this.sortOption = value;
        this.draftFilters = {
            ...this.draftFilters,
            sortField,
            sortDirection,
        };
        this.updateFilters();
    }

    onGroupBySelectionChange(value: GameGroupByField | null | undefined): void {
        const validValues = this.groupByOptions.map(option => option.value);
        const normalized = value && validValues.includes(value) ? value : 'none';
        this.groupByChange.emit(normalized);
    }

    onPlatformSelectionChange(value: string[] | string | null | undefined): void {
        const normalized = this.normalizeSelection(value);
        this.draftFilters = {
            ...this.draftFilters,
            platform: normalized,
        };
        this.updateFilters();
    }

    onGenreSelectionChange(value: string[] | string | null | undefined): void {
        const normalized = this.normalizeSelection(value);
        this.draftFilters = {
            ...this.draftFilters,
            genres: normalized,
        };
        this.updateFilters();
    }

    onCollectionSelectionChange(value: string[] | string | null | undefined): void {
        const normalized = this.normalizeSelection(value);
        this.draftFilters = {
            ...this.draftFilters,
            collections: normalized,
        };
        this.updateFilters();
    }

    onGameTypeSelectionChange(value: GameType[] | GameType | null | undefined): void {
        const normalized = this.normalizeGameTypeSelection(value);
        this.draftFilters = {
            ...this.draftFilters,
            gameTypes: normalized,
        };
        this.updateFilters();
    }

    onTagSelectionChange(value: string[] | string | null | undefined): void {
        const normalized = this.normalizeSelection(value);
        this.draftFilters = {
            ...this.draftFilters,
            tags: this.normalizeTagSelection(normalized),
        };
        this.updateFilters();
    }

    onStatusSelectionChange(value: GameStatusFilterOption[] | GameStatusFilterOption | null | undefined): void {
        const normalized = this.normalizeStatusSelection(value);
        this.draftFilters = {
            ...this.draftFilters,
            statuses: normalized,
        };
        this.updateFilters();
    }

    onRatingSelectionChange(value: GameRatingFilterOption[] | GameRatingFilterOption | null | undefined): void {
        const normalized = this.normalizeRatingSelection(value);
        this.draftFilters = {
            ...this.draftFilters,
            ratings: normalized,
        };
        this.updateFilters();
    }

    onReleaseDateFromChange(value: string | string[] | null | undefined): void {
        this.draftFilters = {
            ...this.draftFilters,
            releaseDateFrom: this.toDateOnly(value),
        };
        this.updateFilters();
    }

    onReleaseDateToChange(value: string | string[] | null | undefined): void {
        this.draftFilters = {
            ...this.draftFilters,
            releaseDateTo: this.toDateOnly(value),
        };
        this.updateFilters();
    }

    onHltbMainHoursMinChange(value: string | number | null | undefined): void {
        const min = this.toNonNegativeNumber(value);
        const max = this.toNonNegativeNumber(this.draftFilters.hltbMainHoursMax);
        this.draftFilters = {
            ...this.draftFilters,
            hltbMainHoursMin: min,
            hltbMainHoursMax: min !== null && max !== null && min > max ? min : max,
        };
        this.updateFilters();
    }

    onHltbMainHoursMaxChange(value: string | number | null | undefined): void {
        const max = this.toNonNegativeNumber(value);
        const min = this.toNonNegativeNumber(this.draftFilters.hltbMainHoursMin);
        this.draftFilters = {
            ...this.draftFilters,
            hltbMainHoursMin: min !== null && max !== null && min > max ? max : min,
            hltbMainHoursMax: max,
        };
        this.updateFilters();
    }

    get releaseDateFromDatetimeId(): string {
        return `${this.menuId}-release-date-from`;
    }

    get releaseDateToDatetimeId(): string {
        return `${this.menuId}-release-date-to`;
    }

    getStatusLabel(status: GameStatusFilterOption): string {
        if (status === 'none') {
            return 'None';
        }

        if (status === 'playing') {
            return 'Playing';
        }

        if (status === 'wantToPlay') {
            return 'Want to Play';
        }

        if (status === 'completed') {
            return 'Completed';
        }

        if (status === 'paused') {
            return 'Paused';
        }

        if (status === 'dropped') {
            return 'Dropped';
        }

        return 'Replay';
    }

    getRatingLabel(rating: GameRatingFilterOption): string {
        if (rating === 'none') {
            return 'None';
        }

        return `${rating}`;
    }

    getGameTypeLabel(gameType: GameType): string {
        if (gameType === 'main_game') {
            return 'Main Game';
        }

        if (gameType === 'dlc_addon') {
            return 'DLC Add-on';
        }

        if (gameType === 'standalone_expansion') {
            return 'Standalone Expansion';
        }

        if (gameType === 'expanded_game') {
            return 'Expanded Game';
        }

        return gameType
            .split('_')
            .filter(part => part.length > 0)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    private toDateOnly(value: string | string[] | null | undefined): string | null {
        if (typeof value !== 'string' || value.length < 10) {
            return null;
        }

        return value.slice(0, 10);
    }

    private toNonNegativeNumber(value: unknown): number | null {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));

        if (!Number.isFinite(parsed) || parsed < 0) {
            return null;
        }

        return Math.round(parsed * 10) / 10;
    }

    private normalizeSelection(value: string[] | string | null | undefined): string[] {
        const normalizedValues = Array.isArray(value)
            ? value
            : typeof value === 'string'
                ? [value]
                : [];
        return normalizeStringList(normalizedValues);
    }

    private normalizeStatusSelection(value: GameStatusFilterOption[] | GameStatusFilterOption | null | undefined): GameStatusFilterOption[] {
        const normalizedValues = Array.isArray(value)
            ? value
            : value
                ? [value]
                : [];

        return normalizeGameStatusFilterList(normalizedValues);
    }

    private normalizeRatingSelection(value: GameRatingFilterOption[] | GameRatingFilterOption | null | undefined): GameRatingFilterOption[] {
        const normalizedValues = Array.isArray(value)
            ? value
            : value !== null && value !== undefined
                ? [value]
                : [];

        return normalizeGameRatingFilterList(normalizedValues);
    }

    private normalizeGameTypeSelection(value: GameType[] | GameType | null | undefined): GameType[] {
        const normalizedValues = Array.isArray(value)
            ? value
            : value
                ? [value]
                : [];

        return normalizeGameTypeList(normalizedValues);
    }

    private normalizeTagSelection(values: string[]): string[] {
        const hasNone = values.includes(this.noneTagFilterValue);
        const tagNames = values.filter(value => value !== this.noneTagFilterValue);

        if (!hasNone) {
            return tagNames;
        }

        return [this.noneTagFilterValue, ...tagNames];
    }

    private isSortOption(value: string): value is SortOption {
        return value === 'title:asc'
            || value === 'title:desc'
            || value === 'releaseDate:asc'
            || value === 'releaseDate:desc'
            || value === 'createdAt:asc'
            || value === 'createdAt:desc'
            || value === 'platform:asc'
            || value === 'platform:desc';
    }
}
