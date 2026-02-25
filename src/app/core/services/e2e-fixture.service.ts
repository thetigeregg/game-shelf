import { Injectable, inject } from '@angular/core';
import { AppDb } from '../data/app-db';
import { CoverSource, GameEntry, ListType } from '../models/game.models';

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
  private readonly db = inject(AppDb);

  async applyFixtureFromStorage(): Promise<void> {
    if (typeof window === 'undefined') {
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

    if (!payload || typeof payload !== 'object') {
      return;
    }

    const shouldResetDb = payload.resetDb !== false;
    const games = Array.isArray(payload.games) ? payload.games : [];
    const normalizedGames = games
      .map((game) => this.normalizeFixtureGame(game))
      .filter((game): game is GameEntry => game !== null);

    if (shouldResetDb) {
      await Promise.all([
        this.db.games.clear(),
        this.db.tags.clear(),
        this.db.views.clear(),
        this.db.imageCache.clear(),
        this.db.outbox.clear(),
        this.db.syncMeta.clear()
      ]);
    }

    if (normalizedGames.length > 0) {
      await this.db.games.bulkPut(normalizedGames);
    }
  }

  private normalizeFixtureGame(value: E2eFixtureGame): GameEntry | null {
    const igdbGameId = typeof value.igdbGameId === 'string' ? value.igdbGameId.trim() : '';
    const platformIgdbId = Number.parseInt(String(value.platformIgdbId ?? ''), 10);
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    const platform =
      typeof value.platform === 'string' ? value.platform.trim() : 'Unknown platform';
    const listType: ListType = value.listType === 'wishlist' ? 'wishlist' : 'collection';
    const now = new Date().toISOString();

    if (!igdbGameId || !Number.isInteger(platformIgdbId) || platformIgdbId <= 0 || !title) {
      return null;
    }

    const notes =
      typeof value.notes === 'string'
        ? value.notes.replace(/\r\n?/g, '\n')
        : value.notes === null
          ? null
          : null;

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
      createdAt: now,
      updatedAt: now
    };
  }
}
