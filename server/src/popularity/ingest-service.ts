import type { Pool, QueryResultRow } from 'pg';

const IGDB_GAME_BATCH_SIZE = 100;

interface PopularityTypeItem {
  id: number;
}

interface PopularityPrimitiveItem {
  gameId: string;
  popularityType: number;
  value: number;
}

interface RawIgdbGame {
  id?: unknown;
  name?: unknown;
  rating?: unknown;
  total_rating_count?: unknown;
  hypes?: unknown;
  follows?: unknown;
  first_release_date?: unknown;
  parent_game?: unknown;
  version_parent?: unknown;
  game_type?: {
    type?: unknown;
  } | null;
  cover?: {
    image_id?: unknown;
  } | null;
  platforms?: Array<{
    id?: unknown;
    name?: unknown;
  }> | null;
}

interface WorkerGamePlatformOption {
  id: number;
  name: string;
}

interface WorkerGameItem {
  igdbGameId: string;
  title: string;
  coverUrl: string | null;
  releaseDate: string | null;
  releaseYear: number | null;
  rating: number | null;
  totalRatingCount: number | null;
  hypes: number | null;
  follows: number | null;
  parentGame: string | null;
  versionParent: string | null;
  gameType: string | null;
  platformOptions: WorkerGamePlatformOption[];
  platforms: string[];
}

interface ExistingGameIdRow extends QueryResultRow {
  igdb_game_id: string;
}

interface PopularityScoreRow extends QueryResultRow {
  popularity_score: string | number | null;
}

interface TwitchTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
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
  twitchClientId: string;
  twitchClientSecret: string;
  requestTimeoutMs: number;
  maxRequestsPerSecond: number;
}

export class PopularityIngestService {
  private tokenCache: { accessToken: string; expiresAtMs: number } | null = null;
  private nextRequestAtMs = 0;

  constructor(
    private readonly pool: Pool,
    private readonly options: PopularityIngestServiceOptions,
    private readonly fetchImpl: typeof fetch = fetch
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

    const signalRows: PopularityPrimitiveItem[] = [];

    for (const typeId of typeIds) {
      const items = await this.fetchPopularityPrimitives(typeId, this.options.signalLimit);
      signalRows.push(...items);
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
    const gameMap = await this.fetchGamesByIds(uniqueGameIds);

    const missingGameIds = await this.findMissingGameIds(uniqueGameIds);
    const gamesInserted = await this.insertMissingGames(missingGameIds, gameMap);
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

    const token = await this.getAccessToken();
    await this.throttle();

    const response = await this.fetchWithTimeout('https://api.igdb.com/v4/popularity_types', {
      method: 'POST',
      headers: {
        'Client-ID': this.options.twitchClientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body: 'fields id; sort id asc; limit 500;'
    });

    if (!response.ok) {
      throw new Error(`Unable to fetch popularity types (${String(response.status)}).`);
    }

    const payload = (await response.json()) as unknown;
    const items = Array.isArray(payload) ? payload : [];

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
    const token = await this.getAccessToken();
    await this.throttle();

    const normalizedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 500;

    const response = await this.fetchWithTimeout('https://api.igdb.com/v4/popularity_primitives', {
      method: 'POST',
      headers: {
        'Client-ID': this.options.twitchClientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body: [
        `where popularity_type = ${String(popularityTypeId)} & game_id != null;`,
        'fields game_id,popularity_type,value;',
        'sort value desc;',
        `limit ${String(normalizedLimit)};`
      ].join(' ')
    });

    if (!response.ok) {
      throw new Error(
        `Unable to fetch popularity primitives for type ${String(popularityTypeId)} (${String(response.status)}).`
      );
    }

    const payload = (await response.json()) as unknown;
    const items = Array.isArray(payload) ? payload : [];

    return items
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }

        const value = item as Record<string, unknown>;
        const gameId = normalizeId(value.game_id);
        const parsedType = toPositiveInteger(value.popularity_type);
        const score = toFiniteNumber(value.value);

        if (!gameId || !parsedType || score === null) {
          return null;
        }

        return {
          gameId,
          popularityType: parsedType,
          value: score
        };
      })
      .filter((item): item is PopularityPrimitiveItem => item !== null);
  }

  private async fetchGamesByIds(gameIds: string[]): Promise<Map<string, WorkerGameItem>> {
    const map = new Map<string, WorkerGameItem>();
    if (gameIds.length === 0) {
      return map;
    }

    const token = await this.getAccessToken();

    for (let index = 0; index < gameIds.length; index += IGDB_GAME_BATCH_SIZE) {
      const batch = gameIds.slice(index, index + IGDB_GAME_BATCH_SIZE);
      await this.throttle();

      const response = await this.fetchWithTimeout('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: {
          'Client-ID': this.options.twitchClientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain'
        },
        body: [
          `where id = (${batch.join(',')});`,
          'fields id,name,rating,total_rating_count,hypes,follows,first_release_date,parent_game,version_parent,game_type.type,cover.image_id,platforms.id,platforms.name;',
          `limit ${String(batch.length)};`
        ].join(' ')
      });

      if (!response.ok) {
        throw new Error(`Unable to fetch IGDB game metadata (${String(response.status)}).`);
      }

      const payload = (await response.json()) as unknown;
      const rows = Array.isArray(payload) ? payload : [];

      for (const raw of rows) {
        const normalized = normalizeIgdbGame(raw as RawIgdbGame);
        if (!normalized) {
          continue;
        }
        map.set(normalized.igdbGameId, normalized);
      }
    }

    return map;
  }

  private async upsertSignals(rows: PopularityPrimitiveItem[]): Promise<void> {
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

  private async insertMissingGames(
    gameIds: string[],
    gameMap: Map<string, WorkerGameItem>
  ): Promise<number> {
    let inserted = 0;

    for (const gameId of gameIds) {
      const item = gameMap.get(gameId);
      if (!item) {
        continue;
      }

      for (const platform of item.platformOptions) {
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

  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    if (this.tokenCache && this.tokenCache.expiresAtMs > now + 30_000) {
      return this.tokenCache.accessToken;
    }

    const tokenUrl = new URL('https://id.twitch.tv/oauth2/token');
    tokenUrl.searchParams.set('client_id', this.options.twitchClientId);
    tokenUrl.searchParams.set('client_secret', this.options.twitchClientSecret);
    tokenUrl.searchParams.set('grant_type', 'client_credentials');

    const response = await this.fetchWithTimeout(tokenUrl.toString(), {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`Twitch token fetch failed with status ${String(response.status)}`);
    }

    const payload = (await response.json()) as TwitchTokenResponse;
    const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : '';
    const expiresIn = toFiniteNumber(payload.expires_in) ?? 0;

    if (accessToken.length === 0) {
      throw new Error('Twitch token response did not include access_token');
    }

    this.tokenCache = {
      accessToken,
      expiresAtMs: now + Math.max(60_000, Math.trunc(expiresIn * 1000))
    };

    return accessToken;
  }

  private async throttle(): Promise<void> {
    const requestsPerSecond = Math.max(1, Math.floor(this.options.maxRequestsPerSecond));
    const minIntervalMs = Math.ceil(1000 / requestsPerSecond);
    const now = Date.now();
    const waitMs = Math.max(0, this.nextRequestAtMs - now);

    if (waitMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, waitMs);
      });
    }

    this.nextRequestAtMs = Math.max(now, this.nextRequestAtMs) + minIntervalMs;
  }

  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const timeoutMs = Math.max(1_000, this.options.requestTimeoutMs);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      return await this.fetchImpl(url, {
        ...options,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function dedupeSignals(rows: PopularityPrimitiveItem[]): PopularityPrimitiveItem[] {
  const byKey = new Map<string, PopularityPrimitiveItem>();

  for (const row of rows) {
    const key = `${row.gameId}:${String(row.popularityType)}`;
    const existing = byKey.get(key);
    if (!existing || row.value > existing.value) {
      byKey.set(key, row);
    }
  }

  return [...byKey.values()];
}

function normalizeIgdbGame(raw: RawIgdbGame): WorkerGameItem | null {
  const igdbGameId = normalizeId(raw.id);
  if (!igdbGameId) {
    return null;
  }

  const title =
    typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : 'Unknown title';

  const platformOptions = Array.isArray(raw.platforms)
    ? raw.platforms
        .map((platform) => {
          const id = toPositiveInteger(platform.id);
          const name = typeof platform.name === 'string' ? platform.name.trim() : '';

          if (!id || name.length === 0) {
            return null;
          }

          return { id, name };
        })
        .filter((item): item is WorkerGamePlatformOption => item !== null)
    : [];

  const platforms = platformOptions.map((platform) => platform.name);

  return {
    igdbGameId,
    title,
    coverUrl: buildCoverUrl(raw.cover?.image_id),
    releaseDate: toIsoFromUnix(raw.first_release_date),
    releaseYear: toReleaseYear(raw.first_release_date),
    rating: toFiniteNumber(raw.rating),
    totalRatingCount: toFiniteNumber(raw.total_rating_count),
    hypes: toFiniteNumber(raw.hypes),
    follows: toFiniteNumber(raw.follows),
    parentGame: normalizeId(raw.parent_game),
    versionParent: normalizeId(raw.version_parent),
    gameType: normalizeGameType(raw.game_type?.type),
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
    coverUrl: item.coverUrl,
    platform: platform.name,
    platformIgdbId: platform.id,
    platforms: item.platforms.length > 0 ? item.platforms : [platform.name],
    platformOptions: [{ id: platform.id, name: platform.name }],
    releaseDate: item.releaseDate,
    releaseYear: item.releaseYear,
    first_release_date: toUnixFromIso(item.releaseDate),
    rating: item.rating,
    total_rating_count: item.totalRatingCount,
    totalRatingCount: item.totalRatingCount,
    hypes: item.hypes,
    follows: item.follows,
    parent_game: item.parentGame,
    parentGame: item.parentGame,
    version_parent: item.versionParent,
    versionParent: item.versionParent,
    gameType: item.gameType ?? 'main_game'
  };
}

function toPositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeId(value: unknown): string | null {
  const parsed = toPositiveInteger(value);
  return parsed ? String(parsed) : null;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoFromUnix(value: unknown): string | null {
  const unix = toPositiveInteger(value);
  if (!unix) {
    return null;
  }

  const date = new Date(unix * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toReleaseYear(value: unknown): number | null {
  const iso = toIsoFromUnix(value);
  if (!iso) {
    return null;
  }
  return new Date(iso).getUTCFullYear();
}

function toUnixFromIso(iso: string | null): number | null {
  if (!iso) {
    return null;
  }

  const timestampMs = Date.parse(iso);
  return Number.isFinite(timestampMs) ? Math.trunc(timestampMs / 1000) : null;
}

function normalizeGameType(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  return normalized.length > 0 ? normalized : null;
}

function buildCoverUrl(imageId: unknown): string | null {
  if (typeof imageId !== 'string') {
    return null;
  }

  const trimmed = imageId.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return `https://images.igdb.com/igdb/image/upload/t_cover_big/${trimmed}.jpg`;
}

function sqlNumericPayload(field: string): string {
  return `CASE WHEN BTRIM(COALESCE(g.payload->>'${field}', '')) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (BTRIM(g.payload->>'${field}'))::double precision ELSE 0 END`;
}
