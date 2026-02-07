import { Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, switchMap, takeUntil, tap } from 'rxjs/operators';
import { GameCatalogResult, ListType } from '../../core/models/game.models';
import { GameShelfService } from '../../core/services/game-shelf.service';

@Component({
  selector: 'app-game-search',
  templateUrl: './game-search.component.html',
  styleUrls: ['./game-search.component.scss'],
  standalone: false,
})
export class GameSearchComponent implements OnInit, OnDestroy {
  @Input({ required: true }) listType!: ListType;

  query = '';
  results: GameCatalogResult[] = [];
  isLoading = false;
  hasSearched = false;
  errorMessage = '';

  private readonly searchTerms$ = new Subject<string>();
  private readonly destroy$ = new Subject<void>();
  private readonly addingExternalIds = new Set<string>();
  private readonly gameShelfService = inject(GameShelfService);

  ngOnInit(): void {
    this.searchTerms$
      .pipe(
        tap(term => {
          const normalized = term.trim();
          this.errorMessage = '';
          this.hasSearched = normalized.length >= 2;

          if (normalized.length < 2) {
            this.results = [];
            this.isLoading = false;
          }
        }),
        debounceTime(300),
        distinctUntilChanged(),
        switchMap(term => {
          const normalized = term.trim();

          if (normalized.length < 2) {
            return of([] as GameCatalogResult[]);
          }

          this.isLoading = true;

          return this.gameShelfService.searchGames(normalized).pipe(
            catchError(() => {
              this.errorMessage = 'Search failed. Please try again.';
              return of([] as GameCatalogResult[]);
            }),
            finalize(() => {
              this.isLoading = false;
            })
          );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe(results => {
        this.results = results;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchChange(value: string | null | undefined): void {
    this.query = value ?? '';
    this.searchTerms$.next(this.query);
  }

  async addGame(result: GameCatalogResult): Promise<void> {
    if (this.isAdding(result.externalId)) {
      return;
    }

    this.addingExternalIds.add(result.externalId);

    try {
      await this.gameShelfService.addGame(result, this.listType);
    } finally {
      this.addingExternalIds.delete(result.externalId);
    }
  }

  isAdding(externalId: string): boolean {
    return this.addingExternalIds.has(externalId);
  }

  trackByExternalId(_: number, result: GameCatalogResult): string {
    return result.externalId;
  }

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/favicon.png';
    }
  }
}
