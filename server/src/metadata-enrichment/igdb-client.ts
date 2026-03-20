import { IgdbMetadataRecord } from './types.js';
import * as mediaNormalization from '../../../shared/igdb-media-normalization.mjs';
import * as storefrontNormalization from '../../../shared/igdb-storefront-normalization.mjs';

const normalizeIgdbScreenshotList = mediaNormalization.normalizeIgdbScreenshotList as (
  value: unknown,
  options?: { limit?: number; size?: string }
) => IgdbMetadataRecord['screenshots'];

const normalizeIgdbVideoList = mediaNormalization.normalizeIgdbVideoList as (
  value: unknown,
  options?: { limit?: number }
) => IgdbMetadataRecord['videos'];
const normalizeIgdbStorefrontLinks = storefrontNormalization.normalizeIgdbStorefrontLinks as (
  input: { externalGames?: unknown; websites?: unknown },
  options?: {
    externalGameSourceNames?: ReadonlyMap<number, string> | null;
    websiteTypeNames?: ReadonlyMap<number, string> | null;
  }
) => IgdbMetadataRecord['storefrontLinks'];
const deriveSteamAppIdFromStorefrontLinks =
  storefrontNormalization.deriveSteamAppIdFromStorefrontLinks as (
    value: unknown
  ) => IgdbMetadataRecord['steamAppId'];

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

interface SourceNameCache {
  values: ReadonlyMap<number, string>;
  expiresAtMs: number;
}

export interface MetadataEnrichmentIgdbClientOptions {
  twitchClientId: string;
  twitchClientSecret: string;
  requestTimeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class MetadataEnrichmentIgdbClient {
  private readonly fetchImpl: typeof fetch;
  private tokenCache: TokenCache | null = null;
  private externalGameSourceCache: SourceNameCache | null = null;
  private websiteTypeCache: SourceNameCache | null = null;

  constructor(private readonly options: MetadataEnrichmentIgdbClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
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
    const [externalGameSourceNames, websiteTypeNames] = await Promise.all([
      this.getExternalGameSourceNames(token),
      this.getWebsiteTypeNames(token),
    ]);
    const body = [
      `where id = (${normalizedIds.join(',')});`,
      [
        'fields id',
        'themes.id,themes.name',
        'keywords.id,keywords.name',
        'screenshots.id,screenshots.image_id,screenshots.url,screenshots.width,screenshots.height',
        'videos.id,videos.name,videos.video_id',
        'external_games.external_game_source,external_games.category,external_games.uid,external_games.url,external_games.platform,external_games.countries,external_games.game_release_format',
        'websites.type,websites.category,websites.url,websites.trusted;',
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
        storefrontLinks: normalizeIgdbStorefrontLinks(
          {
            externalGames: (row as { external_games?: unknown }).external_games,
            websites: (row as { websites?: unknown }).websites,
          },
          {
            externalGameSourceNames,
            websiteTypeNames,
          }
        ),
        steamAppId: null,
      });
      const metadata = map.get(String(id));
      if (metadata) {
        metadata.steamAppId = deriveSteamAppIdFromStorefrontLinks(metadata.storefrontLinks);
      }
    }

    return map;
  }

  private async getExternalGameSourceNames(token: string): Promise<ReadonlyMap<number, string>> {
    const cached = this.externalGameSourceCache;
    const now = Date.now();
    if (cached && cached.expiresAtMs > now) {
      return cached.values;
    }

    const values = await this.fetchNameMap({
      token,
      url: 'https://api.igdb.com/v4/external_game_sources',
      fields: 'fields id,name; limit 500;',
      valueKey: 'name',
    });
    this.externalGameSourceCache = {
      values,
      expiresAtMs: now + 6 * 60 * 60 * 1000,
    };
    return values;
  }

  private async getWebsiteTypeNames(token: string): Promise<ReadonlyMap<number, string>> {
    const cached = this.websiteTypeCache;
    const now = Date.now();
    if (cached && cached.expiresAtMs > now) {
      return cached.values;
    }

    const values = await this.fetchNameMap({
      token,
      url: 'https://api.igdb.com/v4/website_types',
      fields: 'fields id,type; limit 500;',
      valueKey: 'type',
    });
    this.websiteTypeCache = {
      values,
      expiresAtMs: now + 6 * 60 * 60 * 1000,
    };
    return values;
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
    }
  }

  private async fetchNameMap(params: {
    token: string;
    url: string;
    fields: string;
    valueKey: 'name' | 'type';
  }): Promise<ReadonlyMap<number, string>> {
    try {
      const response = await this.fetchWithTimeout(params.url, {
        method: 'POST',
        headers: {
          'Client-ID': this.options.twitchClientId,
          Authorization: `Bearer ${params.token}`,
          'Content-Type': 'text/plain',
        },
        body: params.fields,
      });

      if (!response.ok) {
        return new Map();
      }

      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) {
        return new Map();
      }

      const map = new Map<number, string>();
      for (const entry of payload) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }

        const id = parsePositiveInteger((entry as { id?: unknown }).id);
        const value = (entry as Record<string, unknown>)[params.valueKey];
        const normalizedValue = typeof value === 'string' ? value.trim() : '';
        if (id !== null && normalizedValue.length > 0) {
          map.set(id, normalizedValue);
        }
      }

      return map;
    } catch {
      return new Map();
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
