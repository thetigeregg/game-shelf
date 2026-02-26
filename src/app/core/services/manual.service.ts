import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { StrictHttpParameterCodec } from '../api/strict-http-parameter-codec';
import { SyncOutboxWriter, SYNC_OUTBOX_WRITER } from '../data/sync-outbox-writer';
import { DebugLogService } from './debug-log.service';
import { normalizeHttpError } from '../utils/normalize-http-error';
import {
  GameEntry,
  ManualCandidate,
  ManualOverrideMap,
  ManualResolveResult
} from '../models/game.models';

interface ResolveManualApiResponse {
  status?: unknown;
  bestMatch?: unknown;
  candidates?: unknown;
  unavailable?: unknown;
  reason?: unknown;
}

interface SearchManualsApiResponse {
  items?: unknown;
  unavailable?: unknown;
  reason?: unknown;
}

export const MANUAL_OVERRIDES_STORAGE_KEY = 'game-shelf:manual-overrides-v1';

@Injectable({ providedIn: 'root' })
export class ManualService {
  private static readonly STRICT_HTTP_PARAM_ENCODER = new StrictHttpParameterCodec();
  private readonly httpClient = inject(HttpClient);
  private readonly outboxWriter = inject<SyncOutboxWriter | null>(SYNC_OUTBOX_WRITER, {
    optional: true
  });
  private readonly debugLogService = inject(DebugLogService);
  private readonly apiBaseUrl = this.normalizeBaseUrl(environment.gameApiBaseUrl);
  private readonly manualsBaseUrl = this.normalizeBaseUrl(environment.manualsBaseUrl);
  private readonly resolveManualUrl = `${this.apiBaseUrl}/v1/manuals/resolve`;
  private readonly searchManualsUrl = `${this.apiBaseUrl}/v1/manuals/search`;

  resolveManual(
    game: Pick<GameEntry, 'igdbGameId' | 'platformIgdbId' | 'title'>,
    preferredRelativePath?: string | null
  ): Observable<ManualResolveResult> {
    const params = this.buildResolveParams(game, preferredRelativePath);
    this.debugLogService.debug('manual.service.resolve.request', {
      url: this.resolveManualUrl,
      apiBaseUrl: this.apiBaseUrl,
      gameId: game.igdbGameId,
      platformIgdbId: game.platformIgdbId,
      title: game.title,
      preferredRelativePath: preferredRelativePath ?? null,
      query: params.toString()
    });

    return this.httpClient.get<ResolveManualApiResponse>(this.resolveManualUrl, { params }).pipe(
      tap((response) => {
        this.debugLogService.debug('manual.service.resolve.http_success', {
          url: this.resolveManualUrl,
          query: params.toString(),
          hasResponse: Boolean(response),
          status: response.status ?? null,
          unavailable: response.unavailable === true
        });
      }),
      map((response) => this.normalizeResolveResponse(response)),
      tap((result) => {
        this.debugLogService.debug('manual.service.resolve.normalized', {
          status: result.status,
          unavailable: result.unavailable === true,
          reason: result.reason ?? null,
          bestMatchRelativePath: result.bestMatch?.relativePath ?? null
        });
      }),
      catchError((error: unknown) => {
        this.debugLogService.error('manual.service.resolve.http_error', {
          url: this.resolveManualUrl,
          query: params.toString(),
          error: normalizeHttpError(error)
        });
        return of({
          status: 'none' as const,
          candidates: [],
          unavailable: true,
          reason: 'Unable to resolve manuals right now.'
        });
      })
    );
  }

  searchManuals(
    platformIgdbId: number,
    query: string
  ): Observable<{ items: ManualCandidate[]; unavailable: boolean; reason: string | null }> {
    const normalizedPlatformId =
      Number.isInteger(platformIgdbId) && platformIgdbId > 0 ? platformIgdbId : null;

    if (normalizedPlatformId === null) {
      this.debugLogService.debug('manual.service.search.skipped_invalid_platform', {
        platformIgdbId
      });
      return of({ items: [], unavailable: false, reason: null });
    }

    let params = new HttpParams({ encoder: ManualService.STRICT_HTTP_PARAM_ENCODER }).set(
      'platformIgdbId',
      String(normalizedPlatformId)
    );
    const normalizedQuery = query.trim();

    if (normalizedQuery.length > 0) {
      params = params.set('q', normalizedQuery);
    }
    this.debugLogService.debug('manual.service.search.request', {
      url: this.searchManualsUrl,
      apiBaseUrl: this.apiBaseUrl,
      platformIgdbId: normalizedPlatformId,
      query: normalizedQuery,
      queryString: params.toString()
    });

    return this.httpClient.get<SearchManualsApiResponse>(this.searchManualsUrl, { params }).pipe(
      tap((response) => {
        this.debugLogService.debug('manual.service.search.http_success', {
          url: this.searchManualsUrl,
          queryString: params.toString(),
          hasResponse: Boolean(response),
          unavailable: response.unavailable === true
        });
      }),
      map((response) => {
        const rawUnavailable = response.unavailable;
        const unavailable = rawUnavailable === true;
        const reason =
          typeof response.reason === 'string' && response.reason.trim().length > 0
            ? response.reason.trim()
            : null;
        return {
          items: this.normalizeCandidateList(response.items),
          unavailable,
          reason
        };
      }),
      tap((result) => {
        this.debugLogService.debug('manual.service.search.normalized', {
          items: result.items.length,
          unavailable: result.unavailable,
          reason: result.reason
        });
      }),
      catchError((error: unknown) => {
        this.debugLogService.error('manual.service.search.http_error', {
          url: this.searchManualsUrl,
          queryString: params.toString(),
          error: normalizeHttpError(error)
        });
        return of({
          items: [],
          unavailable: true,
          reason: 'Unable to search manuals right now.'
        });
      })
    );
  }

  getOverride(
    game: Pick<GameEntry, 'igdbGameId' | 'platformIgdbId'>
  ): { relativePath: string; updatedAt: string } | null {
    const key = this.getGameIdentityKey(game);
    const map = this.readOverridesFromStorage();
    if (!Object.prototype.hasOwnProperty.call(map, key)) {
      return null;
    }
    const entry = map[key];

    if (entry.relativePath.trim().length === 0) {
      return null;
    }

    return {
      relativePath: entry.relativePath.trim(),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString()
    };
  }

  setOverride(game: Pick<GameEntry, 'igdbGameId' | 'platformIgdbId'>, relativePath: string): void {
    const key = this.getGameIdentityKey(game);
    const normalizedPath = this.normalizeRelativePath(relativePath);

    if (!normalizedPath) {
      return;
    }

    const nextMap = this.readOverridesFromStorage();
    nextMap[key] = {
      relativePath: normalizedPath,
      updatedAt: new Date().toISOString()
    };
    this.persistOverrides(nextMap);
  }

  clearOverride(game: Pick<GameEntry, 'igdbGameId' | 'platformIgdbId'>): void {
    const key = this.getGameIdentityKey(game);
    const nextMap = this.readOverridesFromStorage();

    if (!Object.prototype.hasOwnProperty.call(nextMap, key)) {
      return;
    }

    const filtered = Object.fromEntries(
      Object.entries(nextMap).filter(([entryKey]) => entryKey !== key)
    ) as ManualOverrideMap;
    this.persistOverrides(filtered);
  }

  getGameIdentityKey(game: Pick<GameEntry, 'igdbGameId' | 'platformIgdbId'>): string {
    return `${game.igdbGameId.trim()}::${String(game.platformIgdbId).trim()}`;
  }

  private buildResolveParams(
    game: Pick<GameEntry, 'igdbGameId' | 'platformIgdbId' | 'title'>,
    preferredRelativePath?: string | null
  ): HttpParams {
    const normalizedGameId = game.igdbGameId.trim();
    const normalizedPlatformId =
      Number.isInteger(game.platformIgdbId) && game.platformIgdbId > 0 ? game.platformIgdbId : null;
    const normalizedTitle = game.title.trim();

    let params = new HttpParams({ encoder: ManualService.STRICT_HTTP_PARAM_ENCODER })
      .set('igdbGameId', normalizedGameId)
      .set('platformIgdbId', normalizedPlatformId === null ? '' : String(normalizedPlatformId))
      .set('title', normalizedTitle);

    const normalizedPreferredPath = this.normalizeRelativePath(preferredRelativePath);
    if (normalizedPreferredPath) {
      params = params.set('preferredRelativePath', normalizedPreferredPath);
    }

    return params;
  }

  private normalizeResolveResponse(response: ResolveManualApiResponse): ManualResolveResult {
    const status = response.status === 'matched' ? 'matched' : 'none';
    const candidates = this.normalizeCandidateList(response.candidates);
    const bestMatchRaw = this.normalizeCandidate(response.bestMatch);
    const source = (response.bestMatch as { source?: unknown } | undefined)?.source;
    const bestMatch = bestMatchRaw
      ? {
          ...bestMatchRaw,
          source: source === 'override' ? ('override' as const) : ('fuzzy' as const)
        }
      : null;

    return {
      status,
      bestMatch,
      candidates,
      unavailable: response.unavailable === true,
      reason:
        typeof response.reason === 'string' && response.reason.trim().length > 0
          ? response.reason.trim()
          : null
    };
  }

  private normalizeCandidateList(value: unknown): ManualCandidate[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => this.normalizeCandidate(item))
      .filter((item): item is ManualCandidate => item !== null);
  }

  private normalizeCandidate(value: unknown): ManualCandidate | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const candidate = value as Record<string, unknown>;
    const platformIgdbIdRaw = candidate['platformIgdbId'];
    const platformIgdbId = Number.parseInt(
      typeof platformIgdbIdRaw === 'string' || typeof platformIgdbIdRaw === 'number'
        ? String(platformIgdbIdRaw)
        : '',
      10
    );
    const fileNameRaw = candidate['fileName'];
    const fileName = typeof fileNameRaw === 'string' ? fileNameRaw.trim() : '';
    const relativePath = this.normalizeRelativePath(candidate['relativePath']);
    const scoreValue =
      typeof candidate['score'] === 'number' && Number.isFinite(candidate['score'])
        ? candidate['score']
        : 0;
    const score = Number(Math.max(0, Math.min(1, scoreValue)).toFixed(4));
    const rawUrl = typeof candidate['url'] === 'string' ? candidate['url'].trim() : '';
    const url = rawUrl.length > 0 ? rawUrl : this.buildManualUrl(relativePath);

    if (
      !Number.isInteger(platformIgdbId) ||
      platformIgdbId <= 0 ||
      fileName.length === 0 ||
      relativePath.length === 0 ||
      url.length === 0
    ) {
      return null;
    }

    return {
      platformIgdbId,
      fileName,
      relativePath,
      score,
      url
    };
  }

  private normalizeRelativePath(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }

    const parts = value
      .replace(/\\/g, '/')
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && part !== '.');

    if (parts.length === 0 || parts.some((part) => part === '..')) {
      return '';
    }

    return parts.join('/');
  }

  private buildManualUrl(relativePath: string): string {
    const encodedPath = relativePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${this.manualsBaseUrl}/${encodedPath}`;
  }

  private readOverridesFromStorage(): ManualOverrideMap {
    try {
      const raw = localStorage.getItem(MANUAL_OVERRIDES_STORAGE_KEY);

      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      const normalized: ManualOverrideMap = {};
      Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return;
        }

        const entry = value as Record<string, unknown>;
        const relativePath = this.normalizeRelativePath(entry['relativePath']);
        const updatedAt =
          typeof entry['updatedAt'] === 'string' && entry['updatedAt'].trim().length > 0
            ? entry['updatedAt']
            : new Date().toISOString();

        if (!relativePath) {
          return;
        }

        normalized[key] = { relativePath, updatedAt };
      });

      return normalized;
    } catch {
      return {};
    }
  }

  private persistOverrides(overrides: ManualOverrideMap): void {
    const keys = Object.keys(overrides);

    if (keys.length === 0) {
      try {
        localStorage.removeItem(MANUAL_OVERRIDES_STORAGE_KEY);
      } catch {
        // Ignore storage failures.
      }
      this.queueOverrideDelete();
      return;
    }

    const serialized = JSON.stringify(overrides);

    try {
      localStorage.setItem(MANUAL_OVERRIDES_STORAGE_KEY, serialized);
    } catch {
      // Ignore storage failures.
    }

    this.queueOverrideUpsert(serialized);
  }

  private queueOverrideUpsert(serializedValue: string): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'setting',
      operation: 'upsert',
      payload: {
        key: MANUAL_OVERRIDES_STORAGE_KEY,
        value: serializedValue
      }
    });
  }

  private queueOverrideDelete(): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'setting',
      operation: 'delete',
      payload: {
        key: MANUAL_OVERRIDES_STORAGE_KEY
      }
    });
  }

  private normalizeBaseUrl(value: string | null | undefined): string {
    const normalized = (value ?? '').trim();
    return normalized.replace(/\/+$/, '');
  }
}
