import type { Pool, QueryResult, QueryResultRow } from 'pg';

const IGDB_GAME_BATCH_SIZE = 100;
const SIGNAL_UPSERT_BATCH_SIZE = 500;
const GAME_INSERT_BATCH_SIZE = 250;
const POPULARITY_INGEST_LOCK_NAMESPACE = 77411;
const POPULARITY_INGEST_LOCK_KEY = 1;

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}

interface IngestRunState {
  tokenCache: { accessToken: string; expiresAtMs: number } | null;
  nextRequestAtMs: number;
}

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

interface ExistingGamePlatformRow extends QueryResultRow {
  igdb_game_id: string;
  platform_igdb_id: number;
}

interface MissingGamePlatform {
  gameId: string;
  platformId: number;
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

    const state: IngestRunState = {
      tokenCache: null,
      nextRequestAtMs: 0
    };
    const client = await this.pool.connect();
    let lockAcquired = false;

    try {
      const lockResult = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS acquired',
        [POPULARITY_INGEST_LOCK_NAMESPACE, POPULARITY_INGEST_LOCK_KEY]
      );

      lockAcquired = lockResult.rows[0]?.acquired ?? false;
      if (!lockAcquired) {
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

      const typeIds = await this.resolvePopularityTypeIds(state);
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
        const items = await this.fetchPopularityPrimitives(typeId, this.options.signalLimit, state);
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
      await this.upsertSignals(dedupedSignals, client);

      const uniqueGameIds = [...new Set(dedupedSignals.map((row) => row.gameId))];
      const gameMap = await this.fetchGamesByIds(uniqueGameIds, state);

      const missingGamePlatforms = await this.findMissingGamePlatforms(gameMap, client);
      const missingGameIds = [...new Set(missingGamePlatforms.map((pair) => pair.gameId))];
      const gamesInserted = await this.insertMissingGames(missingGamePlatforms, gameMap, client);
      const scoresUpdated = await this.recomputeScores(uniqueGameIds, client);

      return {
        enabled: true,
        fetchedTypes: typeIds.length,
        fetchedSignals: signalRows.length,
        upsertedSignals: dedupedSignals.length,
        missingGamesDiscovered: missingGameIds.length,
        gamesInserted,
        scoresUpdated
      };
    } finally {
      try {
        if (lockAcquired) {
          await client.query('SELECT pg_advisory_unlock($1, $2)', [
            POPULARITY_INGEST_LOCK_NAMESPACE,
            POPULARITY_INGEST_LOCK_KEY
          ]);
        }
      } finally {
        client.release();
      }
    }
  }

  private async resolvePopularityTypeIds(state: IngestRunState): Promise<number[]> {
    if (Array.isArray(this.options.sourceTypeIds) && this.options.sourceTypeIds.length > 0) {
      return [
        ...new Set(
          this.options.sourceTypeIds.filter((value) => Number.isInteger(value) && value > 0)
        )
      ];
    }

    const token = await this.getAccessToken(state);
    await this.throttle(state);

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

    return [
      ...new Set(
        items
          .map((item) => {
            const candidate = item as PopularityTypeItem;
            return Number.isInteger(candidate.id) && candidate.id > 0 ? candidate.id : null;
          })
          .filter((value): value is number => value !== null)
      )
    ];
  }

  private async fetchPopularityPrimitives(
    popularityTypeId: number,
    limit: number,
    state: IngestRunState
  ): Promise<PopularityPrimitiveItem[]> {
    const token = await this.getAccessToken(state);
    await this.throttle(state);

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

  private async fetchGamesByIds(
    gameIds: string[],
    state: IngestRunState
  ): Promise<Map<string, WorkerGameItem>> {
    const map = new Map<string, WorkerGameItem>();
    if (gameIds.length === 0) {
      return map;
    }

    const token = await this.getAccessToken(state);

    for (let index = 0; index < gameIds.length; index += IGDB_GAME_BATCH_SIZE) {
      const batch = gameIds.slice(index, index + IGDB_GAME_BATCH_SIZE);
      await this.throttle(state);

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

  private async upsertSignals(
    rows: PopularityPrimitiveItem[],
    queryable: Queryable
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    for (let offset = 0; offset < rows.length; offset += SIGNAL_UPSERT_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + SIGNAL_UPSERT_BATCH_SIZE);
      const values: Array<string | number> = [];
      const valueClauses: string[] = [];

      for (let index = 0; index < batch.length; index += 1) {
        const row = batch[index];
        const base = index * 3;
        const gameIdPlaceholder = String(base + 1);
        const popularityTypePlaceholder = String(base + 2);
        const valuePlaceholder = String(base + 3);
        valueClauses.push(
          `($${gameIdPlaceholder}, $${popularityTypePlaceholder}, $${valuePlaceholder}, NOW())`
        );
        values.push(row.gameId, row.popularityType, row.value);
      }

      await queryable.query(
        `
        INSERT INTO game_popularity (game_id, popularity_type, value, fetched_at)
        VALUES ${valueClauses.join(', ')}
        ON CONFLICT (game_id, popularity_type)
        DO UPDATE
          SET value = EXCLUDED.value,
              fetched_at = NOW()
        `,
        values
      );
    }
  }

  private async findMissingGamePlatforms(
    gameMap: Map<string, WorkerGameItem>,
    queryable: Queryable
  ): Promise<MissingGamePlatform[]> {
    if (gameMap.size === 0) {
      return [];
    }

    const gameIds = [...gameMap.keys()];
    const result = await queryable.query<ExistingGamePlatformRow>(
      `
      SELECT igdb_game_id, platform_igdb_id
      FROM games
      WHERE igdb_game_id = ANY($1::text[])
      `,
      [gameIds]
    );

    const existingPairs = new Set(
      result.rows.map((row) => `${row.igdb_game_id}:${String(row.platform_igdb_id)}`)
    );

    const missingGamePlatforms: MissingGamePlatform[] = [];
    for (const [gameId, game] of gameMap) {
      for (const platform of game.platformOptions) {
        if (existingPairs.has(`${gameId}:${String(platform.id)}`)) {
          continue;
        }

        missingGamePlatforms.push({
          gameId,
          platformId: platform.id
        });
      }
    }

    return missingGamePlatforms;
  }

  private async insertMissingGames(
    missingGamePlatforms: MissingGamePlatform[],
    gameMap: Map<string, WorkerGameItem>,
    queryable: Queryable
  ): Promise<number> {
    const pendingRows: Array<{ igdbGameId: string; platformId: number; payload: string }> = [];

    for (const pair of missingGamePlatforms) {
      const item = gameMap.get(pair.gameId);
      if (!item) {
        continue;
      }

      const platform = item.platformOptions.find((option) => option.id === pair.platformId);
      if (!platform) {
        continue;
      }

      pendingRows.push({
        igdbGameId: item.igdbGameId,
        platformId: platform.id,
        payload: JSON.stringify(buildGamePayload(item, platform))
      });
    }

    if (pendingRows.length === 0) {
      return 0;
    }

    let inserted = 0;

    for (let offset = 0; offset < pendingRows.length; offset += GAME_INSERT_BATCH_SIZE) {
      const batch = pendingRows.slice(offset, offset + GAME_INSERT_BATCH_SIZE);
      const values: Array<string | number> = [];
      const valueClauses: string[] = [];

      for (let index = 0; index < batch.length; index += 1) {
        const row = batch[index];
        const base = index * 3;
        const gameIdPlaceholder = String(base + 1);
        const platformIdPlaceholder = String(base + 2);
        const payloadPlaceholder = String(base + 3);
        valueClauses.push(
          `($${gameIdPlaceholder}, $${platformIdPlaceholder}, $${payloadPlaceholder}::jsonb, NOW())`
        );
        values.push(row.igdbGameId, row.platformId, row.payload);
      }

      const result = await queryable.query(
        `
        INSERT INTO games (igdb_game_id, platform_igdb_id, payload, updated_at)
        VALUES ${valueClauses.join(', ')}
        ON CONFLICT (igdb_game_id, platform_igdb_id)
        DO NOTHING
        `,
        values
      );

      inserted += result.rowCount ?? 0;
    }

    return inserted;
  }

  private async recomputeScores(gameIds: string[], queryable: Queryable): Promise<number> {
    if (gameIds.length === 0) {
      return 0;
    }

    const result = await queryable.query<PopularityScoreRow>(
      `
      WITH target_game_ids AS (
        SELECT DISTINCT UNNEST($1::text[]) AS game_id
      ),
      popularity_max AS (
        SELECT t.game_id, COALESCE(MAX(gp.value), 0) AS max_value
        FROM target_game_ids AS t
        LEFT JOIN game_popularity AS gp ON gp.game_id = t.game_id
        GROUP BY t.game_id
      )
      UPDATE games AS g
      SET popularity_score = (
        COALESCE(pm.max_value, 0) * 3
        + ${sqlNumericPayload('hypes')} * 2
        + ${sqlNumericPayload('follows')} * 1
        + ${sqlNumericPayload('rating')} * 5
        + LN(COALESCE(NULLIF(${sqlNumericPayload('total_rating_count')}, 0), NULLIF(${sqlNumericPayload('totalRatingCount')}, 0), 0) + 1) * 4
      )
      FROM popularity_max AS pm
      WHERE g.igdb_game_id = pm.game_id
      RETURNING popularity_score
      `,
      [gameIds]
    );

    return result.rowCount ?? 0;
  }

  private async getAccessToken(state: IngestRunState): Promise<string> {
    const now = Date.now();

    if (state.tokenCache && state.tokenCache.expiresAtMs > now + 30_000) {
      return state.tokenCache.accessToken;
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

    state.tokenCache = {
      accessToken,
      expiresAtMs: now + Math.max(60_000, Math.trunc(expiresIn * 1000))
    };

    return accessToken;
  }

  private async throttle(state: IngestRunState): Promise<void> {
    const requestsPerSecond = Math.max(1, Math.floor(this.options.maxRequestsPerSecond));
    const minIntervalMs = Math.ceil(1000 / requestsPerSecond);
    const now = Date.now();
    const waitMs = Math.max(0, state.nextRequestAtMs - now);

    if (waitMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, waitMs);
      });
    }

    state.nextRequestAtMs = Math.max(now, state.nextRequestAtMs) + minIntervalMs;
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
