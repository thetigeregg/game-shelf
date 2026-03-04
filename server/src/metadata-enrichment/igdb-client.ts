import { IgdbMetadataRecord } from './types.js';

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

const SCREENSHOT_LIMIT = 20;
const VIDEO_LIMIT = 5;

export interface MetadataEnrichmentIgdbClientOptions {
  twitchClientId: string;
  twitchClientSecret: string;
  requestTimeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class MetadataEnrichmentIgdbClient {
  private readonly fetchImpl: typeof fetch;
  private tokenCache: TokenCache | null = null;

  constructor(private readonly options: MetadataEnrichmentIgdbClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchGameMetadataByIds(gameIds: string[]): Promise<Map<string, IgdbMetadataRecord>> {
    const normalizedIds = [
      ...new Set(
        gameIds
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
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
        'videos.id,videos.name,videos.video_id;'
      ].join(','),
      `limit ${String(normalizedIds.length)};`
    ].join(' ');

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
        screenshots: normalizeScreenshotList((row as { screenshots?: unknown }).screenshots),
        videos: normalizeVideoList((row as { videos?: unknown }).videos)
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
      method: 'POST'
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
    )
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
    )
  ];
}

function normalizeScreenshotList(value: unknown): IgdbMetadataRecord['screenshots'] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: IgdbMetadataRecord['screenshots'] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const imageIdRaw = (entry as { image_id?: unknown }).image_id;
    const imageId = typeof imageIdRaw === 'string' ? imageIdRaw.trim() : '';

    if (!imageId) {
      continue;
    }

    const id = parsePositiveInteger((entry as { id?: unknown }).id);
    const dedupeKey = id !== null ? `id:${String(id)}` : `image:${imageId}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({
      id,
      imageId,
      url: `https://images.igdb.com/igdb/image/upload/t_screenshot_huge/${imageId}.jpg`,
      width: parsePositiveInteger((entry as { width?: unknown }).width),
      height: parsePositiveInteger((entry as { height?: unknown }).height)
    });

    if (normalized.length >= SCREENSHOT_LIMIT) {
      break;
    }
  }

  return normalized;
}

function normalizeVideoList(value: unknown): IgdbMetadataRecord['videos'] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: IgdbMetadataRecord['videos'] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const videoIdRaw = (entry as { video_id?: unknown }).video_id;
    const videoId = typeof videoIdRaw === 'string' ? videoIdRaw.trim() : '';

    if (!videoId) {
      continue;
    }

    const id = parsePositiveInteger((entry as { id?: unknown }).id);
    const dedupeKey = id !== null ? `id:${String(id)}` : `video:${videoId}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    const name = (entry as { name?: unknown }).name;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    normalized.push({
      id,
      name: normalizedName.length > 0 ? normalizedName : null,
      videoId,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    });

    if (normalized.length >= VIDEO_LIMIT) {
      break;
    }
  }

  return normalized;
}
