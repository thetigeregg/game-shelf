import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

const MANUAL_SCAN_CACHE_TTL_MS = 60_000;
const AUTO_MATCH_MIN_SCORE = 0.86;
const AUTO_MATCH_MIN_GAP = 0.08;
const MAX_CANDIDATES = 12;
const MAX_SEARCH_RESULTS = 50;

interface ManualCatalogEntry {
  platformIgdbId: number;
  fileName: string;
  relativePath: string;
  normalizedTitle: string;
  tokens: string[];
  trigrams: Set<string>;
}

interface ManualCatalog {
  entries: ManualCatalogEntry[];
  unavailable: boolean;
  reason: string | null;
}

interface ManualCandidateResponse {
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

interface RegisterManualRoutesOptions {
  manualsDir: string;
  manualsPublicBaseUrl: string;
}

export function parsePlatformIdFromFolderName(folderName: string): number | null {
  const normalized = String(folderName ?? '').trim();
  const match = normalized.match(/__pid-(\d+)$/i);

  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeManualTitle(title: string): string {
  const strippedDiacritics = String(title ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  const withoutParentheticalNoise = strippedDiacritics.replace(
    /\(([^)]*)\)/g,
    (_match, group: string) => {
      const normalizedGroup = String(group ?? '').toLowerCase();
      const isNoise = /(usa|eur|jpn|jp|us|eu|rev|revision|manual|instruction|scan|v\d+)/.test(
        normalizedGroup
      );
      return isNoise ? ' ' : ` ${normalizedGroup} `;
    }
  );

  return withoutParentheticalNoise
    .toLowerCase()
    .replace(/\b(the|manual|instruction|booklet|rev(?:ision)?|version|ver|v\d+)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreManualTitleMatch(queryTitle: string, candidateTitle: string): number {
  const normalizedQuery = normalizeManualTitle(queryTitle);
  const normalizedCandidate = normalizeManualTitle(candidateTitle);

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

export function registerManualRoutes(
  app: FastifyInstance,
  options: RegisterManualRoutesOptions
): void {
  const normalizedManualsPublicBaseUrl = normalizeManualsPublicBaseUrl(
    options.manualsPublicBaseUrl
  );
  let cachedCatalog: ManualCatalog | null = null;
  let cacheExpiresAt = 0;

  app.get('/v1/manuals/resolve', async (request, reply) => {
    const query = request.query as ResolveQuery;
    const platformIgdbId = parsePositiveInteger(query.platformIgdbId);
    const title = String(query.title ?? '').trim();
    const preferredRelativePath = normalizeManualRelativePath(query.preferredRelativePath);

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
        reason: catalog.reason ?? 'Manual catalog unavailable.'
      });
      return;
    }

    const platformEntries = catalog.entries.filter(
      (entry) => entry.platformIgdbId === platformIgdbId
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
            ...toCandidateResponse(preferred, normalizedManualsPublicBaseUrl, 1),
            source: 'override'
          },
          candidates: []
        });
        return;
      }
    }

    if (title.length === 0) {
      reply.send({ status: 'none', candidates: [] });
      return;
    }

    const scored = rankEntriesByTitle(title, platformEntries);
    const candidates = scored
      .slice(0, MAX_CANDIDATES)
      .map((item) => toCandidateResponse(item.entry, normalizedManualsPublicBaseUrl, item.score));
    const top = scored[0];
    const runnerUp = scored[1];
    const scoreGap = top ? top.score - (runnerUp?.score ?? 0) : 0;

    if (top && top.score >= AUTO_MATCH_MIN_SCORE && scoreGap >= AUTO_MATCH_MIN_GAP) {
      reply.send({
        status: 'matched',
        bestMatch: {
          ...toCandidateResponse(top.entry, normalizedManualsPublicBaseUrl, top.score),
          source: 'fuzzy'
        },
        candidates
      });
      return;
    }

    reply.send({
      status: 'none',
      candidates
    });
  });

  app.get('/v1/manuals/search', async (request, reply) => {
    const query = request.query as SearchQuery;
    const platformIgdbId = parsePositiveInteger(query.platformIgdbId);
    const searchQuery = String(query.q ?? '').trim();

    if (platformIgdbId === null) {
      reply.code(400).send({ error: 'platformIgdbId is required.' });
      return;
    }

    const catalog = await readCatalog({ force: false });

    if (catalog.unavailable) {
      reply.send({
        items: [],
        unavailable: true,
        reason: catalog.reason ?? 'Manual catalog unavailable.'
      });
      return;
    }

    const platformEntries = catalog.entries.filter(
      (entry) => entry.platformIgdbId === platformIgdbId
    );

    if (searchQuery.length === 0) {
      const items = [...platformEntries]
        .sort((left, right) =>
          left.fileName.localeCompare(right.fileName, undefined, { sensitivity: 'base' })
        )
        .slice(0, MAX_SEARCH_RESULTS)
        .map((entry) => toCandidateResponse(entry, normalizedManualsPublicBaseUrl, 0));
      reply.send({ items });
      return;
    }

    const items = rankEntriesByTitle(searchQuery, platformEntries)
      .slice(0, MAX_SEARCH_RESULTS)
      .map((item) => toCandidateResponse(item.entry, normalizedManualsPublicBaseUrl, item.score));
    reply.send({ items });
  });

  app.post('/v1/manuals/refresh', async (request, reply) => {
    const query = request.query as RefreshQuery;
    const force = query.force === '1' || query.force === 'true';
    const catalog = await readCatalog({ force });

    reply.send({
      ok: true,
      unavailable: catalog.unavailable,
      reason: catalog.reason,
      count: catalog.entries.length,
      refreshedAt: new Date().toISOString()
    });
  });

  async function readCatalog(params: { force: boolean }): Promise<ManualCatalog> {
    const now = Date.now();

    if (!params.force && cachedCatalog && now < cacheExpiresAt) {
      return cachedCatalog;
    }

    const next = await scanManualsDirectory(options.manualsDir);
    cachedCatalog = next;
    cacheExpiresAt = now + MANUAL_SCAN_CACHE_TTL_MS;
    return next;
  }
}

async function scanManualsDirectory(manualsDir: string): Promise<ManualCatalog> {
  try {
    await fs.access(manualsDir);
  } catch (error) {
    return {
      entries: [],
      unavailable: true,
      reason:
        error instanceof Error ? error.message : `Unable to access manuals directory: ${manualsDir}`
    };
  }

  const entries: ManualCatalogEntry[] = [];
  await walkManuals(manualsDir, '', null, entries);

  return {
    entries: entries.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' })
    ),
    unavailable: false,
    reason: null
  };
}

async function walkManuals(
  baseDir: string,
  relativeDir: string,
  activePlatformId: number | null,
  output: ManualCatalogEntry[]
): Promise<void> {
  const absoluteDir = relativeDir ? path.join(baseDir, relativeDir) : baseDir;
  const children = await fs.readdir(absoluteDir, { withFileTypes: true });

  for (const child of children) {
    const childRelative = relativeDir ? path.posix.join(relativeDir, child.name) : child.name;

    if (child.isDirectory()) {
      const parsedPlatformId = parsePlatformIdFromFolderName(child.name);
      const nextPlatformId = parsedPlatformId ?? activePlatformId;
      await walkManuals(baseDir, childRelative, nextPlatformId, output);
      continue;
    }

    if (!child.isFile() || activePlatformId === null || !/\.pdf$/i.test(child.name)) {
      continue;
    }

    const normalizedRelativePath = normalizeManualRelativePath(childRelative);
    if (!normalizedRelativePath) {
      continue;
    }

    const fileName = child.name;
    const titleWithoutExtension = fileName.replace(/\.pdf$/i, '');
    const normalizedTitle = normalizeManualTitle(titleWithoutExtension);

    if (!normalizedTitle) {
      continue;
    }

    output.push({
      platformIgdbId: activePlatformId,
      fileName,
      relativePath: normalizedRelativePath,
      normalizedTitle,
      tokens: normalizedTitle.split(' ').filter(Boolean),
      trigrams: buildTrigrams(normalizedTitle)
    });
  }
}

function rankEntriesByTitle(
  title: string,
  entries: ManualCatalogEntry[]
): Array<{ entry: ManualCatalogEntry; score: number }> {
  const normalizedTitle = normalizeManualTitle(title);
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
        sensitivity: 'base'
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

function normalizeManualRelativePath(value: unknown): string {
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
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toCandidateResponse(
  entry: ManualCatalogEntry,
  manualsPublicBaseUrl: string,
  score: number
): ManualCandidateResponse {
  return {
    platformIgdbId: entry.platformIgdbId,
    fileName: entry.fileName,
    relativePath: entry.relativePath,
    score: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
    url: buildManualUrl(manualsPublicBaseUrl, entry.relativePath)
  };
}

function buildManualUrl(baseUrl: string, relativePath: string): string {
  const encodedPath = relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${baseUrl}/${encodedPath}`;
}

function normalizeManualsPublicBaseUrl(value: string): string {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return '/manuals';
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized.replace(/\/+$/, '');
  }

  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return prefixed.replace(/\/+$/, '');
}
