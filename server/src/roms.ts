import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { applyRouteRateLimit } from './rate-limit.js';

const ROM_SCAN_CACHE_TTL_MS = 60_000;
const ROMS_CATALOG_SNAPSHOT_KEY = 'roms.catalog.snapshot.v1';
const AUTO_MATCH_MIN_SCORE = 0.86;
const AUTO_MATCH_MIN_GAP = 0.08;
const MAX_CANDIDATES = 12;
const MAX_SEARCH_RESULTS = 50;
const PLATFORM_ROM_ALIAS_TO_CANONICAL: Record<number, number> = {
  99: 18,
  51: 18,
  58: 19,
  137: 37,
  159: 20,
  510: 24,
};

interface RomCatalogEntry {
  platformIgdbId: number;
  fileName: string;
  relativePath: string;
  normalizedTitle: string;
  tokens: string[];
  trigrams: Set<string>;
}

interface RomCatalog {
  entries: RomCatalogEntry[];
  unavailable: boolean;
  reason: string | null;
}

interface RomCandidateResponse {
  platformIgdbId: number;
  fileName: string;
  relativePath: string;
  score: number;
  url: string;
}

interface ResolveQuery {
  igdbGameId?: string;
  platformIgdbId?: string;
  title?: string;
  preferredRelativePath?: string;
}

interface SearchQuery {
  platformIgdbId?: string;
  q?: string;
}

interface RefreshQuery {
  force?: string;
}

interface RegisterRomRoutesOptions {
  romsDir: string;
  romsPublicBaseUrl: string;
  mode?: 'inline' | 'queue';
  queuePool?: Pool;
  enqueueCatalogRefreshJob?: (payload: RomsCatalogRefreshPayload) => void;
  queueSnapshotTtlMs?: number;
}

export interface RomsCatalogRefreshPayload {
  reason: string;
  requestedAt: string;
  force: boolean;
}

export function parsePlatformIdFromFolderName(folderName: string): number | null {
  const normalized = folderName.trim();
  const match = normalized.match(/__pid-(\d+)$/i);

  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeRomTitle(title: string): string {
  const strippedDiacritics = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const withoutParentheticalNoise = strippedDiacritics.replace(
    /\(([^)]*)\)/g,
    (_match, group: string) => {
      const normalizedGroup = group.toLowerCase();
      const isNoise = /(usa|eur|jpn|jp|us|eu|rev|revision|disc|disk|cd\s*\d+|dvd|rom|v\d+)/.test(
        normalizedGroup
      );
      return isNoise ? ' ' : ` ${normalizedGroup} `;
    }
  );

  return withoutParentheticalNoise
    .toLowerCase()
    .replace(
      /\b(the|disc|disk|cd|dvd|rom|rev(?:ision)?|version|ver|v\d+|instruction|booklet|manual)\b/g,
      ' '
    )
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreRomTitleMatch(queryTitle: string, candidateTitle: string): number {
  const normalizedQuery = normalizeRomTitle(queryTitle);
  const normalizedCandidate = normalizeRomTitle(candidateTitle);

  if (!normalizedQuery || !normalizedCandidate) {
    return 0;
  }

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const candidateTokens = normalizedCandidate.split(' ').filter(Boolean);
  const tokenScore = calculateTokenJaccard(queryTokens, candidateTokens);
  const trigramScore = calculateTrigramDice(
    buildTrigrams(normalizedQuery),
    buildTrigrams(normalizedCandidate)
  );
  let score = tokenScore * 0.6 + trigramScore * 0.4;

  if (normalizedQuery === normalizedCandidate) {
    score += 0.08;
  }

  const tokenDelta = Math.abs(queryTokens.length - candidateTokens.length);
  if (tokenDelta >= 3) {
    score -= Math.min(0.15, tokenDelta * 0.04);
  }

  if (score < 0) {
    return 0;
  }

  return Number(Math.min(1, score).toFixed(4));
}

export function registerRomRoutes(app: FastifyInstance, options: RegisterRomRoutesOptions): void {
  const normalizedRomsPublicBaseUrl = normalizeRomsPublicBaseUrl(options.romsPublicBaseUrl);
  const mode = options.mode ?? 'inline';
  let cachedCatalog: RomCatalog | null = null;
  let cacheExpiresAt = 0;

  app.route({
    method: 'GET',
    url: '/v1/roms/resolve',
    config: applyRouteRateLimit('roms_read'),
    handler: async (request, reply) => {
      setNoStoreCacheHeaders(reply);

      const query = request.query as ResolveQuery;
      const platformIgdbId = parsePositiveInteger(query.platformIgdbId);
      const title = (query.title ?? '').trim();
      const preferredRelativePath = normalizeRomRelativePath(query.preferredRelativePath);

      if (platformIgdbId === null) {
        reply.code(400).send({ error: 'platformIgdbId is required.' });
        return;
      }

      const catalog = await readCatalog({ force: false });

      if (catalog.unavailable) {
        reply.send({
          status: 'none',
          candidates: [],
          unavailable: true,
          reason: catalog.reason ?? 'ROM catalog unavailable.',
        });
        return;
      }

      const equivalentPlatformIds = buildEquivalentRomPlatformIds(platformIgdbId);
      const platformEntries = catalog.entries.filter((entry) =>
        equivalentPlatformIds.has(entry.platformIgdbId)
      );

      if (platformEntries.length === 0) {
        reply.send({ status: 'none', candidates: [] });
        return;
      }

      if (preferredRelativePath) {
        const preferred = platformEntries.find(
          (entry) => entry.relativePath === preferredRelativePath
        );

        if (preferred) {
          reply.send({
            status: 'matched',
            bestMatch: {
              ...toRomCandidateResponse(preferred, normalizedRomsPublicBaseUrl, 1),
              source: 'override',
            },
            candidates: [],
          });
          return;
        }
      }

      if (title.length === 0) {
        reply.send({ status: 'none', candidates: [] });
        return;
      }

      const scored = rankRomEntriesByTitle(title, platformEntries);
      const candidates = scored
        .slice(0, MAX_CANDIDATES)
        .map((item) => toRomCandidateResponse(item.entry, normalizedRomsPublicBaseUrl, item.score));
      const top = scored[0];
      const scoreGap = scored.length > 1 ? top.score - scored[1].score : top.score;

      if (top.score >= AUTO_MATCH_MIN_SCORE && scoreGap >= AUTO_MATCH_MIN_GAP) {
        reply.send({
          status: 'matched',
          bestMatch: {
            ...toRomCandidateResponse(top.entry, normalizedRomsPublicBaseUrl, top.score),
            source: 'fuzzy',
          },
          candidates,
        });
        return;
      }

      reply.send({
        status: 'none',
        candidates,
      });
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/roms/search',
    config: applyRouteRateLimit('roms_read'),
    handler: async (request, reply) => {
      setNoStoreCacheHeaders(reply);

      const query = request.query as SearchQuery;
      const platformIgdbId = parsePositiveInteger(query.platformIgdbId);
      const searchQuery = (query.q ?? '').trim();

      if (platformIgdbId === null) {
        reply.code(400).send({ error: 'platformIgdbId is required.' });
        return;
      }

      const catalog = await readCatalog({ force: false });

      if (catalog.unavailable) {
        reply.send({
          items: [],
          unavailable: true,
          reason: catalog.reason ?? 'ROM catalog unavailable.',
        });
        return;
      }

      const equivalentPlatformIds = buildEquivalentRomPlatformIds(platformIgdbId);
      const platformEntries = catalog.entries.filter((entry) =>
        equivalentPlatformIds.has(entry.platformIgdbId)
      );

      if (searchQuery.length === 0) {
        const items = [...platformEntries]
          .sort((left, right) =>
            left.fileName.localeCompare(right.fileName, undefined, { sensitivity: 'base' })
          )
          .slice(0, MAX_SEARCH_RESULTS)
          .map((entry) => toRomCandidateResponse(entry, normalizedRomsPublicBaseUrl, 0));
        reply.send({ items });
        return;
      }

      const items = rankRomEntriesByTitle(searchQuery, platformEntries)
        .slice(0, MAX_SEARCH_RESULTS)
        .map((item) => toRomCandidateResponse(item.entry, normalizedRomsPublicBaseUrl, item.score));
      reply.send({ items });
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/roms/refresh',
    config: applyRouteRateLimit('roms_refresh'),
    handler: async (request, reply) => {
      setNoStoreCacheHeaders(reply);

      const query = request.query as RefreshQuery;
      const force = query.force === '1' || query.force === 'true';
      const catalog = await readCatalog({ force });

      reply.send({
        ok: true,
        unavailable: catalog.unavailable,
        reason: catalog.reason,
        count: catalog.entries.length,
        refreshedAt: new Date().toISOString(),
      });
    },
  });

  async function readCatalog(params: { force: boolean }): Promise<RomCatalog> {
    if (mode === 'queue') {
      return readCatalogViaQueue(params);
    }

    const now = Date.now();

    if (!params.force && cachedCatalog && now < cacheExpiresAt) {
      return cachedCatalog;
    }

    const next = await scanRomsDirectory(options.romsDir);
    cachedCatalog = next;
    cacheExpiresAt = now + ROM_SCAN_CACHE_TTL_MS;
    return next;
  }

  async function readCatalogViaQueue(params: { force: boolean }): Promise<RomCatalog> {
    const queuePool = options.queuePool;
    if (!queuePool) {
      return {
        entries: [],
        unavailable: true,
        reason: 'roms queue mode requires queuePool',
      };
    }

    const now = Date.now();
    const snapshotTtlMs = Math.max(5_000, options.queueSnapshotTtlMs ?? ROM_SCAN_CACHE_TTL_MS);

    if (!params.force && cachedCatalog && now < cacheExpiresAt) {
      return cachedCatalog;
    }

    const snapshot = await readRomCatalogSnapshot(queuePool);
    const builtAtMs = snapshot?.builtAt ? Date.parse(snapshot.builtAt) : Number.NaN;
    const hasFreshSnapshot = Number.isFinite(builtAtMs) && now - builtAtMs <= snapshotTtlMs;
    const shouldQueueRefresh = params.force || !hasFreshSnapshot;

    if (shouldQueueRefresh && options.enqueueCatalogRefreshJob) {
      options.enqueueCatalogRefreshJob({
        reason: params.force ? 'rom-refresh-endpoint' : 'rom-catalog-stale',
        requestedAt: new Date(now).toISOString(),
        force: params.force,
      });
    }

    if (snapshot?.catalog) {
      cachedCatalog = snapshot.catalog;
      cacheExpiresAt = now + ROM_SCAN_CACHE_TTL_MS;
      return snapshot.catalog;
    }

    return {
      entries: [],
      unavailable: true,
      reason: 'ROM catalog is warming up.',
    };
  }
}

function setNoStoreCacheHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
}

async function scanRomsDirectory(romsDir: string): Promise<RomCatalog> {
  try {
    await fs.access(romsDir);
  } catch (error) {
    return {
      entries: [],
      unavailable: true,
      reason:
        error instanceof Error ? error.message : `Unable to access roms directory: ${romsDir}`,
    };
  }

  const entries: RomCatalogEntry[] = [];
  await walkRoms(romsDir, '', null, entries);

  return {
    entries: entries.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' })
    ),
    unavailable: false,
    reason: null,
  };
}

export async function processQueuedRomsCatalogRefresh(
  pool: Pool,
  romsDir: string
): Promise<{ count: number; unavailable: boolean }> {
  const catalog = await scanRomsDirectory(romsDir);
  await writeRomCatalogSnapshot(pool, catalog, new Date().toISOString());
  return {
    count: catalog.entries.length,
    unavailable: catalog.unavailable,
  };
}

async function walkRoms(
  baseDir: string,
  relativeDir: string,
  activePlatformId: number | null,
  output: RomCatalogEntry[]
): Promise<void> {
  const absoluteDir = relativeDir ? path.join(baseDir, relativeDir) : baseDir;
  const children = await fs.readdir(absoluteDir, { withFileTypes: true });

  for (const child of children) {
    const childRelative = relativeDir ? path.posix.join(relativeDir, child.name) : child.name;

    if (child.isDirectory()) {
      const parsedPlatformId = parsePlatformIdFromFolderName(child.name);
      const nextPlatformId = parsedPlatformId ?? activePlatformId;

      // Multi-file ROM sets are modeled as one matchable entry by using
      // the first file in the folder as a representative launch target.
      if (nextPlatformId !== null && parsedPlatformId === null) {
        const childAbsoluteDir = path.join(baseDir, childRelative);
        const childEntries = await fs.readdir(childAbsoluteDir, { withFileTypes: true });
        const fileEntries = childEntries
          .filter((entry) => entry.isFile())
          .sort((left, right) => left.name.localeCompare(right.name));

        if (fileEntries.length === 0) {
          await walkRoms(baseDir, childRelative, nextPlatformId, output);
          continue;
        }

        const representativeFile = fileEntries[0];
        const normalizedRelativePath = normalizeRomRelativePath(
          path.posix.join(childRelative, representativeFile.name)
        );
        const normalizedTitle = normalizeRomTitle(child.name);

        output.push({
          platformIgdbId: nextPlatformId,
          fileName: child.name,
          relativePath: normalizedRelativePath,
          normalizedTitle,
          tokens: normalizedTitle.split(' ').filter(Boolean),
          trigrams: buildTrigrams(normalizedTitle),
        });

        continue;
      }

      await walkRoms(baseDir, childRelative, nextPlatformId, output);
      continue;
    }

    if (!child.isFile() || activePlatformId === null) {
      continue;
    }

    const normalizedRelativePath = normalizeRomRelativePath(childRelative);
    if (!normalizedRelativePath) {
      continue;
    }

    const fileName = child.name;
    const titleWithoutExtension = removeFileExtension(fileName);
    const normalizedTitle = normalizeRomTitle(titleWithoutExtension);

    if (!normalizedTitle) {
      continue;
    }

    output.push({
      platformIgdbId: activePlatformId,
      fileName,
      relativePath: normalizedRelativePath,
      normalizedTitle,
      tokens: normalizedTitle.split(' ').filter(Boolean),
      trigrams: buildTrigrams(normalizedTitle),
    });
  }
}

function removeFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/u, '');
}

function rankRomEntriesByTitle(
  title: string,
  entries: RomCatalogEntry[]
): Array<{ entry: RomCatalogEntry; score: number }> {
  const normalizedTitle = normalizeRomTitle(title);
  if (!normalizedTitle) {
    return [];
  }

  const titleTokens = normalizedTitle.split(' ').filter(Boolean);
  const titleTrigrams = buildTrigrams(normalizedTitle);

  return entries
    .map((entry) => {
      let score =
        calculateTokenJaccard(titleTokens, entry.tokens) * 0.6 +
        calculateTrigramDice(titleTrigrams, entry.trigrams) * 0.4;

      if (normalizedTitle === entry.normalizedTitle) {
        score += 0.08;
      }

      const tokenDelta = Math.abs(titleTokens.length - entry.tokens.length);
      if (tokenDelta >= 3) {
        score -= Math.min(0.15, tokenDelta * 0.04);
      }

      const normalizedScore = Number(Math.min(1, Math.max(0, score)).toFixed(4));
      return { entry, score: normalizedScore };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      return left.entry.fileName.localeCompare(right.entry.fileName, undefined, {
        sensitivity: 'base',
      });
    });
}

function calculateTokenJaccard(leftTokens: string[], rightTokens: string[]): number {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);

  if (left.size === 0 && right.size === 0) {
    return 1;
  }

  const union = new Set([...left, ...right]);
  let intersectionCount = 0;

  left.forEach((token) => {
    if (right.has(token)) {
      intersectionCount += 1;
    }
  });

  return union.size === 0 ? 0 : intersectionCount / union.size;
}

function calculateTrigramDice(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }

  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let overlap = 0;
  left.forEach((item) => {
    if (right.has(item)) {
      overlap += 1;
    }
  });

  return (2 * overlap) / (left.size + right.size);
}

function buildTrigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, '');

  if (compact.length === 0) {
    return new Set<string>();
  }

  if (compact.length < 3) {
    return new Set<string>([compact]);
  }

  const trigrams = new Set<string>();

  for (let index = 0; index <= compact.length - 3; index += 1) {
    trigrams.add(compact.slice(index, index + 3));
  }

  return trigrams;
}

function normalizeRomRelativePath(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const withForwardSlashes = value.replace(/\\/g, '/');
  const parts = withForwardSlashes
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '.');

  if (parts.length === 0 || parts.some((part) => part === '..')) {
    return '';
  }

  return parts.join('/');
}

function parsePositiveInteger(value: unknown): number | null {
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'bigint'
        ? String(value)
        : '';
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildEquivalentRomPlatformIds(platformIgdbId: number): Set<number> {
  const canonicalPlatformId = PLATFORM_ROM_ALIAS_TO_CANONICAL[platformIgdbId] ?? platformIgdbId;
  const ids = new Set<number>([canonicalPlatformId]);

  Object.entries(PLATFORM_ROM_ALIAS_TO_CANONICAL).forEach(([sourceIdRaw, destinationId]) => {
    if (destinationId !== canonicalPlatformId) {
      return;
    }

    const sourceId = Number.parseInt(sourceIdRaw, 10);
    if (Number.isInteger(sourceId) && sourceId > 0) {
      ids.add(sourceId);
    }
  });

  return ids;
}

function toRomCandidateResponse(
  entry: RomCatalogEntry,
  romsPublicBaseUrl: string,
  score: number
): RomCandidateResponse {
  return {
    platformIgdbId: entry.platformIgdbId,
    fileName: entry.fileName,
    relativePath: entry.relativePath,
    score: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
    url: buildRomUrl(romsPublicBaseUrl, entry.relativePath),
  };
}

interface RomCatalogSnapshotRow {
  setting_value: string;
}

interface RomCatalogSnapshotRecord {
  builtAt: string;
  catalog: RomCatalog;
}

interface RomCatalogSnapshotEntry {
  platformIgdbId: number;
  fileName: string;
  relativePath: string;
  normalizedTitle: string;
  tokens?: unknown;
  trigrams?: unknown;
}

interface SerializedRomCatalogSnapshotRecord {
  builtAt?: unknown;
  catalog?: {
    entries?: unknown;
    unavailable?: unknown;
    reason?: unknown;
  };
}

async function readRomCatalogSnapshot(pool: Pool): Promise<RomCatalogSnapshotRecord | null> {
  const result = await pool.query<RomCatalogSnapshotRow>(
    `
    SELECT setting_value
    FROM settings
    WHERE setting_key = $1
    LIMIT 1
    `,
    [ROMS_CATALOG_SNAPSHOT_KEY]
  );
  const raw = result.rows[0]?.setting_value;
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as SerializedRomCatalogSnapshotRecord;
    const builtAt =
      typeof parsed.builtAt === 'string' && Number.isFinite(Date.parse(parsed.builtAt))
        ? parsed.builtAt
        : null;
    const catalog = normalizeRomCatalogSnapshot(parsed.catalog);
    if (!builtAt || !catalog) {
      return null;
    }
    return { builtAt, catalog };
  } catch {
    return null;
  }
}

async function writeRomCatalogSnapshot(
  pool: Pool,
  catalog: RomCatalog,
  builtAt: string
): Promise<void> {
  const payload = JSON.stringify({
    builtAt,
    catalog: serializeRomCatalogForSnapshot(catalog),
  });
  await pool.query(
    `
    INSERT INTO settings (setting_key, setting_value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (setting_key)
    DO UPDATE SET
      setting_value = EXCLUDED.setting_value,
      updated_at = NOW()
    `,
    [ROMS_CATALOG_SNAPSHOT_KEY, payload]
  );
}

function normalizeRomCatalogSnapshot(value: unknown): RomCatalog | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as { entries?: unknown; unavailable?: unknown; reason?: unknown };
  if (!Array.isArray(raw.entries)) {
    return null;
  }

  const entries: RomCatalogEntry[] = [];
  for (const entry of raw.entries) {
    const normalizedEntry = normalizeRomCatalogEntrySnapshot(entry);
    if (normalizedEntry) {
      entries.push(normalizedEntry);
    }
  }

  return {
    entries,
    unavailable: raw.unavailable === true,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
  };
}

function normalizeRomCatalogEntrySnapshot(value: unknown): RomCatalogEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entry = value as RomCatalogSnapshotEntry;
  if (!Number.isInteger(entry.platformIgdbId) || entry.platformIgdbId <= 0) {
    return null;
  }
  if (typeof entry.fileName !== 'string' || entry.fileName.trim().length === 0) {
    return null;
  }
  const relativePath = normalizeRomRelativePath(entry.relativePath);
  if (!relativePath) {
    return null;
  }
  const normalizedTitle = normalizeRomTitle(entry.normalizedTitle);
  if (!normalizedTitle) {
    return null;
  }

  const tokens = Array.isArray(entry.tokens)
    ? entry.tokens.filter((token): token is string => typeof token === 'string' && token.length > 0)
    : normalizedTitle.split(' ').filter(Boolean);
  const trigrams = Array.isArray(entry.trigrams)
    ? new Set(
        entry.trigrams.filter(
          (trigram): trigram is string => typeof trigram === 'string' && trigram.length > 0
        )
      )
    : buildTrigrams(normalizedTitle);

  return {
    platformIgdbId: entry.platformIgdbId,
    fileName: entry.fileName,
    relativePath,
    normalizedTitle,
    tokens,
    trigrams,
  };
}

function serializeRomCatalogForSnapshot(catalog: RomCatalog): {
  entries: Array<{
    platformIgdbId: number;
    fileName: string;
    relativePath: string;
    normalizedTitle: string;
    tokens: string[];
    trigrams: string[];
  }>;
  unavailable: boolean;
  reason: string | null;
} {
  return {
    entries: catalog.entries.map((entry) => ({
      platformIgdbId: entry.platformIgdbId,
      fileName: entry.fileName,
      relativePath: entry.relativePath,
      normalizedTitle: entry.normalizedTitle,
      tokens: entry.tokens,
      trigrams: Array.from(entry.trigrams),
    })),
    unavailable: catalog.unavailable,
    reason: catalog.reason,
  };
}

function buildRomUrl(baseUrl: string, relativePath: string): string {
  const encodedPath = relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${baseUrl}/${encodedPath}`;
}

function normalizeRomsPublicBaseUrl(value: string): string {
  const normalized = value.trim();

  if (!normalized) {
    return '/roms';
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized.replace(/\/+$/, '');
  }

  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return prefixed.replace(/\/+$/, '');
}
