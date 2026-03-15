import type { Pool, QueryResultRow } from 'pg';
import { fetchMetadataPathFromWorker } from '../metadata.js';

interface PopularityTypeItem {
  id: number;
}

interface WorkerGamePlatformOption {
  id: number;
  name: string;
}

interface WorkerGameItem {
  igdbGameId: string;
  title: string;
  coverUrl?: string | null;
  releaseDate?: string | null;
  releaseYear?: number | null;
  platformOptions: WorkerGamePlatformOption[];
  platforms: string[];
}

interface PopularityPrimitiveItem {
  popularityType: number;
  value: number;
  game: WorkerGameItem;
}

interface ExistingGameIdRow extends QueryResultRow {
  igdb_game_id: string;
}

interface PopularityScoreRow extends QueryResultRow {
  popularity_score: string | number | null;
}

export interface PopularityIngestSummary {
  enabled: boolean;
  fetchedTypes: number;
  fetchedSignals: number;
  upsertedSignals: number;
  missingGamesDiscovered: number;
  gamesInserted: number;
  scoresUpdated: number;
}

export interface PopularityIngestServiceOptions {
  enabled: boolean;
  signalLimit: number;
  sourceTypeIds?: number[];
}

export class PopularityIngestService {
  constructor(
    private readonly pool: Pool,
    private readonly options: PopularityIngestServiceOptions
  ) {}

  async runOnce(): Promise<PopularityIngestSummary> {
    if (!this.options.enabled) {
      return {
        enabled: false,
        fetchedTypes: 0,
        fetchedSignals: 0,
        upsertedSignals: 0,
        missingGamesDiscovered: 0,
        gamesInserted: 0,
        scoresUpdated: 0
      };
    }

    const typeIds = await this.resolvePopularityTypeIds();
    if (typeIds.length === 0) {
      return {
        enabled: true,
        fetchedTypes: 0,
        fetchedSignals: 0,
        upsertedSignals: 0,
        missingGamesDiscovered: 0,
        gamesInserted: 0,
        scoresUpdated: 0
      };
    }

    const signalRows: Array<{ gameId: string; popularityType: number; value: number }> = [];

    for (const typeId of typeIds) {
      const items = await this.fetchPopularityPrimitives(typeId, this.options.signalLimit);
      for (const item of items) {
        const gameId = item.game.igdbGameId.trim();
        if (!/^\d+$/.test(gameId)) {
          continue;
        }
        signalRows.push({
          gameId,
          popularityType: item.popularityType,
          value: item.value
        });
      }
    }

    if (signalRows.length === 0) {
      return {
        enabled: true,
        fetchedTypes: typeIds.length,
        fetchedSignals: 0,
        upsertedSignals: 0,
        missingGamesDiscovered: 0,
        gamesInserted: 0,
        scoresUpdated: 0
      };
    }

    const dedupedSignals = dedupeSignals(signalRows);
    await this.upsertSignals(dedupedSignals);

    const uniqueGameIds = [...new Set(dedupedSignals.map((row) => row.gameId))];
    const missingGameIds = await this.findMissingGameIds(uniqueGameIds);
    const gamesInserted = await this.insertMissingGames(missingGameIds);
    const scoresUpdated = await this.recomputeScores(uniqueGameIds);

    return {
      enabled: true,
      fetchedTypes: typeIds.length,
      fetchedSignals: signalRows.length,
      upsertedSignals: dedupedSignals.length,
      missingGamesDiscovered: missingGameIds.length,
      gamesInserted,
      scoresUpdated
    };
  }

  private async resolvePopularityTypeIds(): Promise<number[]> {
    if (Array.isArray(this.options.sourceTypeIds) && this.options.sourceTypeIds.length > 0) {
      return [
        ...new Set(
          this.options.sourceTypeIds.filter((value) => Number.isInteger(value) && value > 0)
        )
      ];
    }

    const response = await fetchMetadataPathFromWorker('/v1/popularity/types');
    if (!response.ok) {
      throw new Error(`Unable to fetch popularity types (${String(response.status)}).`);
    }

    const payload = (await response.json()) as { items?: unknown };
    const items = Array.isArray(payload.items) ? payload.items : [];

    return items
      .map((item) => {
        const candidate = item as PopularityTypeItem;
        return Number.isInteger(candidate.id) && candidate.id > 0 ? candidate.id : null;
      })
      .filter((value): value is number => value !== null);
  }

  private async fetchPopularityPrimitives(
    popularityTypeId: number,
    limit: number
  ): Promise<PopularityPrimitiveItem[]> {
    const response = await fetchMetadataPathFromWorker('/v1/popularity/primitives', {
      popularityTypeId,
      limit,
      offset: 0
    });

    if (!response.ok) {
      throw new Error(
        `Unable to fetch popularity primitives for type ${String(popularityTypeId)} (${String(response.status)}).`
      );
    }

    const payload = (await response.json()) as { items?: unknown };
    const items = Array.isArray(payload.items) ? payload.items : [];

    return items
      .map((item) => normalizePrimitive(item))
      .filter((item): item is PopularityPrimitiveItem => item !== null);
  }

  private async upsertSignals(
    rows: Array<{ gameId: string; popularityType: number; value: number }>
  ): Promise<void> {
    for (const row of rows) {
      await this.pool.query(
        `
        INSERT INTO game_popularity (game_id, popularity_type, value, fetched_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (game_id, popularity_type)
        DO UPDATE
          SET value = EXCLUDED.value,
              fetched_at = NOW()
        `,
        [row.gameId, row.popularityType, row.value]
      );
    }
  }

  private async findMissingGameIds(gameIds: string[]): Promise<string[]> {
    if (gameIds.length === 0) {
      return [];
    }

    const result = await this.pool.query<ExistingGameIdRow>(
      `
      SELECT DISTINCT igdb_game_id
      FROM games
      WHERE igdb_game_id = ANY($1::text[])
      `,
      [gameIds]
    );

    const existing = new Set(result.rows.map((row) => row.igdb_game_id));
    return gameIds.filter((gameId) => !existing.has(gameId));
  }

  private async insertMissingGames(gameIds: string[]): Promise<number> {
    let inserted = 0;

    for (const gameId of gameIds) {
      const response = await fetchMetadataPathFromWorker(`/v1/games/${gameId}`);
      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as { item?: unknown };
      const item = normalizeWorkerGame(payload.item);
      if (!item) {
        continue;
      }

      const platformOptions = item.platformOptions.length > 0 ? item.platformOptions : [];
      for (const platform of platformOptions) {
        await this.pool.query(
          `
          INSERT INTO games (igdb_game_id, platform_igdb_id, payload, updated_at)
          VALUES ($1, $2, $3::jsonb, NOW())
          ON CONFLICT (igdb_game_id, platform_igdb_id)
          DO UPDATE
            SET payload = EXCLUDED.payload,
                updated_at = NOW()
          `,
          [item.igdbGameId, platform.id, JSON.stringify(buildGamePayload(item, platform))]
        );
        inserted += 1;
      }
    }

    return inserted;
  }

  private async recomputeScores(gameIds: string[]): Promise<number> {
    if (gameIds.length === 0) {
      return 0;
    }

    const result = await this.pool.query<PopularityScoreRow>(
      `
      UPDATE games AS g
      SET popularity_score = (
        COALESCE((
          SELECT MAX(gp.value)
          FROM game_popularity AS gp
          WHERE gp.game_id = g.igdb_game_id
        ), 0) * 3
        + ${sqlNumericPayload('hypes')} * 2
        + ${sqlNumericPayload('follows')} * 1
        + ${sqlNumericPayload('rating')} * 5
        + LN(COALESCE(NULLIF(${sqlNumericPayload('total_rating_count')}, 0), NULLIF(${sqlNumericPayload('totalRatingCount')}, 0), 0) + 1) * 4
      )
      WHERE g.igdb_game_id = ANY($1::text[])
      RETURNING popularity_score
      `,
      [gameIds]
    );

    return result.rowCount ?? 0;
  }
}

function dedupeSignals(
  rows: Array<{ gameId: string; popularityType: number; value: number }>
): Array<{ gameId: string; popularityType: number; value: number }> {
  const byKey = new Map<string, { gameId: string; popularityType: number; value: number }>();

  for (const row of rows) {
    const key = `${row.gameId}:${String(row.popularityType)}`;
    const existing = byKey.get(key);
    if (!existing || row.value > existing.value) {
      byKey.set(key, row);
    }
  }

  return [...byKey.values()];
}

function normalizePrimitive(value: unknown): PopularityPrimitiveItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const item = value as Record<string, unknown>;
  const popularityType =
    typeof item.popularityType === 'number' && Number.isInteger(item.popularityType)
      ? item.popularityType
      : typeof item.popularityType === 'string'
        ? Number.parseInt(item.popularityType, 10)
        : Number.NaN;
  const scoreValue =
    typeof item.value === 'number'
      ? item.value
      : typeof item.value === 'string'
        ? Number.parseFloat(item.value)
        : Number.NaN;

  if (!Number.isInteger(popularityType) || popularityType <= 0 || !Number.isFinite(scoreValue)) {
    return null;
  }

  const game = normalizeWorkerGame(item.game);
  if (!game) {
    return null;
  }

  return {
    popularityType,
    value: scoreValue,
    game
  };
}

function normalizeWorkerGame(value: unknown): WorkerGameItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const item = value as Record<string, unknown>;
  const igdbGameId = typeof item.igdbGameId === 'string' ? item.igdbGameId.trim() : '';
  if (!/^\d+$/.test(igdbGameId)) {
    return null;
  }

  const title =
    typeof item.title === 'string' && item.title.trim().length > 0
      ? item.title.trim()
      : 'Unknown title';

  const platformOptions = Array.isArray(item.platformOptions)
    ? item.platformOptions
        .map((platform) => {
          if (!platform || typeof platform !== 'object' || Array.isArray(platform)) {
            return null;
          }
          const candidate = platform as Record<string, unknown>;
          const id =
            typeof candidate.id === 'number'
              ? Math.trunc(candidate.id)
              : typeof candidate.id === 'string'
                ? Number.parseInt(candidate.id, 10)
                : Number.NaN;
          const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
          if (!Number.isInteger(id) || id <= 0 || name.length === 0) {
            return null;
          }
          return { id, name };
        })
        .filter((platform): platform is WorkerGamePlatformOption => platform !== null)
    : [];

  const platforms = Array.isArray(item.platforms)
    ? item.platforms
        .map((platform) => (typeof platform === 'string' ? platform.trim() : ''))
        .filter((platform) => platform.length > 0)
    : [];

  return {
    igdbGameId,
    title,
    coverUrl: typeof item.coverUrl === 'string' ? item.coverUrl : null,
    releaseDate: typeof item.releaseDate === 'string' ? item.releaseDate : null,
    releaseYear:
      typeof item.releaseYear === 'number' && Number.isInteger(item.releaseYear)
        ? item.releaseYear
        : null,
    platformOptions,
    platforms
  };
}

function buildGamePayload(
  item: WorkerGameItem,
  platform: WorkerGamePlatformOption
): Record<string, unknown> {
  return {
    igdbGameId: item.igdbGameId,
    externalId: item.igdbGameId,
    title: item.title,
    coverUrl: item.coverUrl ?? null,
    platform: platform.name,
    platformIgdbId: platform.id,
    platforms: item.platforms.length > 0 ? item.platforms : [platform.name],
    platformOptions: [{ id: platform.id, name: platform.name }],
    releaseDate: item.releaseDate ?? null,
    releaseYear: item.releaseYear ?? null,
    first_release_date: toFirstReleaseDateUnix(item.releaseDate)
  };
}

function toFirstReleaseDateUnix(releaseDate: string | null | undefined): number | null {
  if (typeof releaseDate !== 'string' || releaseDate.trim().length === 0) {
    return null;
  }

  const unixMs = Date.parse(releaseDate);
  if (!Number.isFinite(unixMs)) {
    return null;
  }

  return Math.trunc(unixMs / 1000);
}

function sqlNumericPayload(field: string): string {
  return `CASE WHEN BTRIM(COALESCE(g.payload->>'${field}', '')) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (BTRIM(g.payload->>'${field}'))::double precision ELSE 0 END`;
}
