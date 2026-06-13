import { Injectable, inject } from '@angular/core';
import { STORAGE_ENGINE } from '../data/storage-engine';
import { CoverSource, GameEntry, ListType } from '../models/game.models';
import { isE2eFixturesEnabled } from '../config/runtime-config';
import { HtmlSanitizerService } from '../security/html-sanitizer.service';

const E2E_FIXTURE_STORAGE_KEY = 'game-shelf:e2e-fixture';

interface E2eFixturePayload {
  resetDb?: boolean;
  games?: E2eFixtureGame[];
}

interface E2eFixtureGame {
  igdbGameId: string;
  platformIgdbId: number;
  title: string;
  platform?: string;
  listType?: ListType;
  notes?: string | null;
}

@Injectable({ providedIn: 'root' })
export class E2eFixtureService {
  private readonly engine = inject(STORAGE_ENGINE);
  private readonly htmlSanitizer = inject(HtmlSanitizerService);

  async applyFixtureFromStorage(): Promise<void> {
    if (typeof window === 'undefined' || !isE2eFixturesEnabled()) {
      return;
    }

    const raw = window.localStorage.getItem(E2E_FIXTURE_STORAGE_KEY);

    if (!raw) {
      return;
    }

    window.localStorage.removeItem(E2E_FIXTURE_STORAGE_KEY);

    let payload: E2eFixturePayload | null = null;
    try {
      payload = JSON.parse(raw) as E2eFixturePayload;
    } catch {
      return;
    }

    const shouldResetDb = payload.resetDb !== false;
    const games = Array.isArray(payload.games) ? payload.games : [];
    const normalizedGames = games
      .map((game) => this.normalizeFixtureGame(game))
      .filter((game): game is GameEntry => game !== null);

    if (shouldResetDb) {
      await Promise.all([
        this.engine.clearGames(),
        this.engine.clearTags(),
        this.engine.clearViews(),
        this.engine.clearImageCache(),
        this.engine.clearOutbox(),
        this.engine.clearSyncMeta(),
      ]);
    }

    if (normalizedGames.length > 0) {
      await this.engine.bulkPutGames(normalizedGames);
    }
  }

  private normalizeFixtureGame(value: unknown): GameEntry | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const fixture = value as Partial<E2eFixtureGame>;
    const igdbGameId = typeof fixture.igdbGameId === 'string' ? fixture.igdbGameId.trim() : '';
    const platformIgdbId = Number.parseInt(String(fixture.platformIgdbId ?? ''), 10);
    const title = typeof fixture.title === 'string' ? fixture.title.trim() : '';
    const platform =
      typeof fixture.platform === 'string' ? fixture.platform.trim() : 'Unknown platform';
    const listType: ListType = fixture.listType === 'wishlist' ? 'wishlist' : 'collection';
    const now = new Date().toISOString();

    if (!igdbGameId || !Number.isInteger(platformIgdbId) || platformIgdbId <= 0 || !title) {
      return null;
    }

    const notes = this.normalizeFixtureNotes(fixture.notes);

    const normalizedCoverSource: CoverSource = 'none';

    return {
      igdbGameId,
      platformIgdbId,
      title,
      platform,
      listType,
      notes,
      coverUrl: null,
      customCoverUrl: null,
      coverSource: normalizedCoverSource,
      storyline: null,
      summary: null,
      gameType: null,
      hltbMainHours: null,
      hltbMainExtraHours: null,
      hltbCompletionistHours: null,
      similarGameIgdbIds: [],
      collections: [],
      developers: [],
      franchises: [],
      genres: [],
      publishers: [],
      customPlatform: null,
      customPlatformIgdbId: null,
      tagIds: [],
      releaseDate: null,
      releaseYear: null,
      status: null,
      rating: null,
      enteredCollectionAt: listType === 'collection' ? now : null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private normalizeFixtureNotes(value: unknown): string | null {
    return this.htmlSanitizer.sanitizeNotesOrNull(value);
  }
}
