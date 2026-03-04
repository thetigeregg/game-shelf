interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

interface GameTypeCache {
  mainGameTypeIds: number[];
  expiresAtMs: number;
}

export interface DiscoveryIgdbClientOptions {
  twitchClientId: string;
  twitchClientSecret: string;
  requestTimeoutMs: number;
  maxRequestsPerSecond: number;
  fetchImpl?: typeof fetch;
}

export interface DiscoveryCandidateRecord {
  igdbGameId: string;
  platformIgdbId: number;
  payload: Record<string, unknown>;
  source: 'popular' | 'recent';
  sourceScore: number;
}

interface RawIgdbGame {
  id?: number;
  name?: string;
  summary?: string;
  storyline?: string;
  first_release_date?: number;
  platforms?: Array<{ id?: number; name?: string }>;
  genres?: Array<{ name?: string }>;
  themes?: Array<{ name?: string }>;
  keywords?: Array<{ name?: string }>;
  collections?: Array<{ name?: string }>;
  franchises?: Array<{ name?: string }>;
  involved_companies?: Array<{
    developer?: boolean;
    publisher?: boolean;
    company?: { name?: string };
  }>;
  total_rating?: number;
  total_rating_count?: number;
  aggregated_rating?: number;
  aggregated_rating_count?: number;
}

interface RawGameType {
  id?: number;
  type?: string;
}

const IGDB_PAGE_SIZE = 500;
const GAME_TYPES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RECENT_MAX_FUTURE_DAYS = 365;
const RECENT_MIN_RATING_COUNT = 25;

export class DiscoveryIgdbClient {
  private readonly fetchImpl: typeof fetch;
  private tokenCache: TokenCache | null = null;
  private gameTypeCache: GameTypeCache | null = null;
  private nextRequestAtMs = 0;

  constructor(private readonly options: DiscoveryIgdbClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchDiscoveryCandidates(params: {
    poolSize: number;
    preferredPlatformIds: number[];
  }): Promise<DiscoveryCandidateRecord[]> {
    const targetSize = Math.max(1, params.poolSize);
    const mainGameTypeIds = await this.getMainGameTypeIds();
    const [popularGames, recentGames] = await Promise.all([
      this.fetchBySource('popular', targetSize, mainGameTypeIds),
      this.fetchBySource('recent', targetSize, mainGameTypeIds)
    ]);

    const merged = [...popularGames, ...recentGames];
    const deduped = new Map<string, DiscoveryCandidateRecord>();
    const preferredSet = new Set(params.preferredPlatformIds);

    for (const item of merged) {
      if (
        preferredSet.size > 0 &&
        !preferredSet.has(item.platformIgdbId) &&
        deduped.size >= Math.ceil(targetSize / 3)
      ) {
        continue;
      }

      const key = `${item.igdbGameId}::${String(item.platformIgdbId)}`;
      const existing = deduped.get(key);
      if (!existing || item.sourceScore > existing.sourceScore) {
        deduped.set(key, item);
      }
    }

    return [...deduped.values()].sort(compareCandidates).slice(0, targetSize);
  }

  async fetchDiscoveryCandidatesBySource(params: {
    source: 'popular' | 'recent';
    poolSize: number;
    preferredPlatformIds: number[];
  }): Promise<DiscoveryCandidateRecord[]> {
    const targetSize = Math.max(1, params.poolSize);
    const mainGameTypeIds = await this.getMainGameTypeIds();
    const rows = await this.fetchBySource(params.source, targetSize, mainGameTypeIds);
    const preferredSet = new Set(params.preferredPlatformIds);

    if (preferredSet.size === 0) {
      return [...rows].sort(compareCandidates).slice(0, targetSize);
    }

    const preferred = rows.filter((entry) => preferredSet.has(entry.platformIgdbId));
    const other = rows.filter((entry) => !preferredSet.has(entry.platformIgdbId));
    return [...preferred, ...other].sort(compareCandidates).slice(0, targetSize);
  }

  private async fetchBySource(
    source: 'popular' | 'recent',
    desired: number,
    mainGameTypeIds: number[]
  ): Promise<DiscoveryCandidateRecord[]> {
    const candidates: DiscoveryCandidateRecord[] = [];
    let offset = 0;

    while (candidates.length < desired) {
      const chunk = await this.fetchGamesChunk({
        source,
        offset,
        limit: Math.min(IGDB_PAGE_SIZE, desired),
        mainGameTypeIds
      });
      if (chunk.length === 0) {
        break;
      }

      candidates.push(...chunk);
      offset += IGDB_PAGE_SIZE;

      if (chunk.length < IGDB_PAGE_SIZE) {
        break;
      }
    }

    return candidates;
  }

  private async fetchGamesChunk(params: {
    source: 'popular' | 'recent';
    offset: number;
    limit: number;
    mainGameTypeIds: number[];
  }): Promise<DiscoveryCandidateRecord[]> {
    const token = await this.getAccessToken();
    await this.throttle();
    const body = buildGamesQuery({
      source: params.source,
      offset: params.offset,
      limit: params.limit,
      mainGameTypeIds: params.mainGameTypeIds
    });
    const response = await this.fetchWithTimeout('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': this.options.twitchClientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body
    });

    if (!response.ok) {
      const errorBody = await safeReadText(response);
      throw new Error(
        `IGDB discovery fetch failed (${params.source}) with status ${String(response.status)}${errorBody ? `: ${errorBody.slice(0, 280)}` : ''}`
      );
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      return [];
    }

    const rows: DiscoveryCandidateRecord[] = [];

    for (const raw of payload as RawIgdbGame[]) {
      const igdbGameId = parsePositiveInteger(raw.id);
      if (!igdbGameId) {
        continue;
      }

      const platforms = normalizePlatforms(raw.platforms);
      if (platforms.length === 0) {
        continue;
      }

      const releaseYear = normalizeReleaseYear(raw.first_release_date);
      const title = normalizeText(raw.name);
      if (!title) {
        continue;
      }

      const score = computeSourceScore(raw, params.source);
      const developers = normalizeCompanies(raw.involved_companies, 'developer');
      const publishers = normalizeCompanies(raw.involved_companies, 'publisher');
      const payloadBase: Record<string, unknown> = {
        igdbGameId: String(igdbGameId),
        title,
        summary: normalizeText(raw.summary),
        storyline: normalizeText(raw.storyline),
        releaseYear,
        genres: normalizeNamedList(raw.genres),
        themes: normalizeNamedList(raw.themes),
        keywords: normalizeNamedList(raw.keywords),
        collections: normalizeNamedList(raw.collections),
        franchises: normalizeNamedList(raw.franchises),
        developers,
        publishers,
        reviewScore: normalizeFinite(
          raw.total_rating ?? raw.aggregated_rating ?? raw.aggregated_rating_count
        ),
        metacriticScore: null,
        mobyScore: null,
        reviewSource: null,
        hltbMainHours: null,
        hltbMainExtraHours: null,
        hltbCompletionistHours: null,
        status: null,
        rating: null,
        listType: 'discovery'
      };

      for (const platform of platforms) {
        rows.push({
          igdbGameId: String(igdbGameId),
          platformIgdbId: platform.id,
          payload: {
            ...payloadBase,
            platformIgdbId: platform.id,
            platform: platform.name,
            platforms: [platform.name],
            platformOptions: [{ id: platform.id, name: platform.name }]
          },
          source: params.source,
          sourceScore: score
        });
      }
    }

    return rows;
  }

  private async getMainGameTypeIds(): Promise<number[]> {
    const now = Date.now();

    if (this.gameTypeCache && this.gameTypeCache.expiresAtMs > now) {
      return this.gameTypeCache.mainGameTypeIds;
    }

    const token = await this.getAccessToken();
    await this.throttle();

    const response = await this.fetchWithTimeout('https://api.igdb.com/v4/game_types', {
      method: 'POST',
      headers: {
        'Client-ID': this.options.twitchClientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body: 'fields id,type;'
    });

    if (!response.ok) {
      const errorBody = await safeReadText(response);
      throw new Error(
        `IGDB game_types fetch failed with status ${String(response.status)}${errorBody ? `: ${errorBody.slice(0, 280)}` : ''}`
      );
    }

    const payload: unknown = await response.json();
    const mainGameTypeIds = Array.isArray(payload)
      ? payload
          .map((entry) => {
            if (!entry || typeof entry !== 'object') {
              return null;
            }

            const type = (entry as RawGameType).type;
            if (normalizeGameTypeLabel(type) !== 'main game') {
              return null;
            }

            return parsePositiveInteger((entry as RawGameType).id);
          })
          .filter((id): id is number => Number.isInteger(id) && id > 0)
      : [];

    this.gameTypeCache = {
      mainGameTypeIds,
      expiresAtMs: now + GAME_TYPES_CACHE_TTL_MS
    };

    return mainGameTypeIds;
  }

  private async throttle(): Promise<void> {
    const rps = Math.max(1, Math.floor(this.options.maxRequestsPerSecond));
    const minIntervalMs = Math.ceil(1000 / rps);
    const now = Date.now();
    const waitMs = Math.max(0, this.nextRequestAtMs - now);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.nextRequestAtMs = Math.max(now, this.nextRequestAtMs) + minIntervalMs;
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

    const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : '';
    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 0;
    if (!accessToken) {
      throw new Error('Twitch token response did not include access_token');
    }

    this.tokenCache = {
      accessToken,
      expiresAtMs: now + Math.max(60_000, Math.trunc(expiresIn * 1000))
    };

    return accessToken;
  }

  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.options.requestTimeoutMs);

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

function buildGamesQuery(params: {
  source: 'popular' | 'recent';
  offset: number;
  limit: number;
  mainGameTypeIds: number[];
}): string {
  const sortClause =
    params.source === 'popular' ? 'sort total_rating_count desc;' : 'sort first_release_date desc;';
  const recentMaxReleaseUnix =
    Math.floor(Date.now() / 1000) + RECENT_MAX_FUTURE_DAYS * 24 * 60 * 60;
  const gameTypeClause =
    params.mainGameTypeIds.length > 0 ? ` & game_type = (${params.mainGameTypeIds.join(',')})` : '';
  const sourceWhereClause =
    params.source === 'popular'
      ? `where total_rating_count != null & platforms != null & parent_game = null & version_parent = null${gameTypeClause};`
      : `where first_release_date != null & first_release_date <= ${String(recentMaxReleaseUnix)} & platforms != null & parent_game = null & version_parent = null${gameTypeClause} & (total_rating_count >= ${String(RECENT_MIN_RATING_COUNT)} | aggregated_rating_count >= ${String(RECENT_MIN_RATING_COUNT)});`;

  return [
    'fields id,name,summary,storyline,first_release_date,platforms.id,platforms.name,',
    'genres.name,themes.name,keywords.name,collections.name,franchises.name,',
    'involved_companies.company.name,involved_companies.developer,involved_companies.publisher,',
    'total_rating,total_rating_count,aggregated_rating,aggregated_rating_count;',
    sourceWhereClause,
    sortClause,
    `limit ${String(params.limit)};`,
    `offset ${String(params.offset)};`
  ].join(' ');
}

function normalizeGameTypeLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  return null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNamedList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return '';
          }
          const name = (entry as { name?: unknown }).name;
          return typeof name === 'string' ? name.trim() : '';
        })
        .filter((entry) => entry.length > 0)
    )
  ];
}

function normalizeCompanies(value: unknown, mode: 'developer' | 'publisher'): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return '';
          }
          const company = (entry as { company?: { name?: unknown } }).company;
          const isDeveloper = Boolean((entry as { developer?: unknown }).developer);
          const isPublisher = Boolean((entry as { publisher?: unknown }).publisher);
          if ((mode === 'developer' && !isDeveloper) || (mode === 'publisher' && !isPublisher)) {
            return '';
          }
          const name = company?.name;
          return typeof name === 'string' ? name.trim() : '';
        })
        .filter((entry) => entry.length > 0)
    )
  ];
}

function normalizePlatforms(value: unknown): Array<{ id: number; name: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: Array<{ id: number; name: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const id = parsePositiveInteger((entry as { id?: unknown }).id);
    const name = normalizeText((entry as { name?: unknown }).name);
    if (!id || !name) {
      continue;
    }
    rows.push({ id, name });
  }

  const dedupe = new Map<number, { id: number; name: string }>();
  for (const row of rows) {
    dedupe.set(row.id, row);
  }

  return [...dedupe.values()];
}

function normalizeReleaseYear(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const date = new Date(value * 1000);
  const year = date.getUTCFullYear();
  if (!Number.isInteger(year) || year < 1970 || year > 2200) {
    return null;
  }
  return year;
}

function normalizeFinite(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function computeSourceScore(row: RawIgdbGame, source: 'popular' | 'recent'): number {
  if (source === 'recent') {
    const release = typeof row.first_release_date === 'number' ? row.first_release_date : 0;
    return release > 0 ? release : 0;
  }

  const count =
    typeof row.total_rating_count === 'number'
      ? row.total_rating_count
      : typeof row.aggregated_rating_count === 'number'
        ? row.aggregated_rating_count
        : 0;
  const rating =
    typeof row.total_rating === 'number'
      ? row.total_rating
      : typeof row.aggregated_rating === 'number'
        ? row.aggregated_rating
        : 0;
  return count * 1000 + rating;
}

function compareCandidates(
  left: DiscoveryCandidateRecord,
  right: DiscoveryCandidateRecord
): number {
  if (left.sourceScore !== right.sourceScore) {
    return right.sourceScore - left.sourceScore;
  }
  if (left.igdbGameId !== right.igdbGameId) {
    return left.igdbGameId.localeCompare(right.igdbGameId, 'en');
  }
  return left.platformIgdbId - right.platformIgdbId;
}
