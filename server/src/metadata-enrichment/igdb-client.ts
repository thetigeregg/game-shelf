import { IgdbMetadataRecord } from './types.js';
import * as mediaNormalization from '../../../shared/igdb-media-normalization.mjs';
import {
  createProviderLimiter,
  type ProviderLimiter,
  ProviderThrottleError,
} from '../provider-rate-limit.js';
import { resolveOutboundRateLimit } from '../rate-limit.js';

const normalizeIgdbScreenshotList = mediaNormalization.normalizeIgdbScreenshotList as (
  value: unknown,
  options?: { limit?: number; size?: string }
) => IgdbMetadataRecord['screenshots'];

const normalizeIgdbVideoList = mediaNormalization.normalizeIgdbVideoList as (
  value: unknown,
  options?: { limit?: number }
) => IgdbMetadataRecord['videos'];

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

export interface MetadataEnrichmentIgdbClientOptions {
  twitchClientId: string;
  twitchClientSecret: string;
  requestTimeoutMs: number;
  fetchImpl?: typeof fetch;
  limiter?: ProviderLimiter;
}

export class MetadataEnrichmentIgdbClient {
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: ProviderLimiter;
  private tokenCache: TokenCache | null = null;

  constructor(private readonly options: MetadataEnrichmentIgdbClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.limiter =
      options.limiter ??
      createProviderLimiter(
        'igdb_metadata_enrichment',
        {
          ...resolveOutboundRateLimit('igdb_metadata_enrichment'),
          requestTimeoutMs: options.requestTimeoutMs,
        },
        { now: () => Date.now() }
      );
  }

  async fetchGameMetadataByIds(gameIds: string[]): Promise<Map<string, IgdbMetadataRecord>> {
    const normalizedIds = [
      ...new Set(
        gameIds
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isInteger(value) && value > 0)
      ),
    ];

    if (normalizedIds.length === 0) {
      return new Map();
    }

    const token = await this.getAccessToken();
    const body = [
      `where id = (${normalizedIds.join(',')});`,
      [
        'fields id',
        'themes.id,themes.name',
        'keywords.id,keywords.name',
        'screenshots.id,screenshots.image_id,screenshots.url,screenshots.width,screenshots.height',
        'videos.id,videos.name,videos.video_id',
        'external_games.external_game_source,external_games.category,external_games.uid,external_games.url,external_games.platform;',
      ].join(','),
      `limit ${String(normalizedIds.length)};`,
    ].join(' ');

    const response = await this.fetchWithTimeout('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': this.options.twitchClientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body,
    });

    if (!response.ok) {
      if (response.status === 429) {
        this.limiter.consumeRateLimitHeaders(response.headers);
        throw new ProviderThrottleError({
          policyName: 'igdb_metadata_enrichment',
          source: 'upstream_429',
          retryAfterSeconds: this.limiter.getCooldownRemainingSeconds(),
          message: 'IGDB metadata enrichment request throttled',
        });
      }
      throw new Error(`IGDB metadata fetch failed with status ${String(response.status)}`);
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      return new Map();
    }

    const map = new Map<string, IgdbMetadataRecord>();
    for (const row of payload) {
      const id = parsePositiveInteger((row as { id?: unknown }).id);
      if (!Number.isInteger(id) || id <= 0) {
        continue;
      }

      map.set(String(id), {
        themes: normalizeNameList((row as { themes?: unknown }).themes),
        themeIds: normalizeIdList((row as { themes?: unknown }).themes),
        keywords: normalizeNameList((row as { keywords?: unknown }).keywords),
        keywordIds: normalizeIdList((row as { keywords?: unknown }).keywords),
        screenshots: normalizeIgdbScreenshotList((row as { screenshots?: unknown }).screenshots, {
          limit: 20,
          size: 't_screenshot_huge',
        }),
        videos: normalizeIgdbVideoList((row as { videos?: unknown }).videos, {
          limit: 5,
        }),
        steamAppId: normalizeSteamAppId((row as { external_games?: unknown }).external_games),
      });
    }

    return map;
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
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Twitch token fetch failed with status ${String(response.status)}`);
    }

    const payload: unknown = await response.json();
    const accessToken =
      typeof (payload as { access_token?: unknown }).access_token === 'string'
        ? (payload as { access_token: string }).access_token.trim()
        : '';
    const expiresIn =
      typeof (payload as { expires_in?: unknown }).expires_in === 'number'
        ? (payload as { expires_in: number }).expires_in
        : 0;

    if (!accessToken) {
      throw new Error('Twitch token response did not include access_token');
    }

    this.tokenCache = {
      accessToken,
      expiresAtMs: now + Math.max(60_000, Math.trunc(expiresIn * 1000)),
    };

    return accessToken;
  }

  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const lease = await this.limiter.acquire();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.options.requestTimeoutMs);

    try {
      return await this.fetchImpl(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
      lease.release();
    }
  }
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function normalizeNameList(value: unknown): string[] {
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
    ),
  ];
}

function normalizeIdList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return Number.NaN;
          }

          const id = (entry as { id?: unknown }).id;
          const parsed = parsePositiveInteger(id);
          return parsed ?? Number.NaN;
        })
        .filter((entry) => Number.isInteger(entry) && entry > 0)
    ),
  ];
}

const STEAM_EXTERNAL_GAME_SOURCE_ID = 1;
const STEAM_EXTERNAL_GAME_CATEGORY_ID = 1;
const STEAM_URL_APP_ID_PATTERN = /store\.steampowered\.com\/app\/(\d+)/i;

function normalizeSteamAppId(value: unknown): number | null {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const externalGameSourceId = parsePositiveInteger(record['external_game_source']);
    const categoryId = parsePositiveInteger(record['category']);
    const isSteamBySource = externalGameSourceId === STEAM_EXTERNAL_GAME_SOURCE_ID;
    const isSteamByDeprecatedCategory = categoryId === STEAM_EXTERNAL_GAME_CATEGORY_ID;

    if (!isSteamBySource && !isSteamByDeprecatedCategory) {
      continue;
    }

    const uidAppId = parsePositiveInteger(record['uid']);
    if (uidAppId !== null) {
      return uidAppId;
    }

    const urlValue = typeof record['url'] === 'string' ? record['url'].trim() : '';
    const match = STEAM_URL_APP_ID_PATTERN.exec(urlValue);
    if (match) {
      const parsedFromUrl = parsePositiveInteger(match[1]);
      if (parsedFromUrl !== null) {
        return parsedFromUrl;
      }
    }
  }

  return null;
}
