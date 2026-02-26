import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import {
  normalizeManualTitle,
  parsePlatformIdFromFolderName,
  registerManualRoutes,
  scoreManualTitleMatch
} from './manuals.js';

type MatchPayload = {
  status: string;
  unavailable?: boolean;
  bestMatch?: {
    source?: string;
    relativePath?: string;
    platformIgdbId?: number;
  };
  candidates?: unknown[];
};

type SearchPayload = {
  items: Array<{
    relativePath?: string;
    fileName?: string;
    platformIgdbId?: number;
  }>;
  unavailable?: boolean;
};

type RefreshPayload = {
  ok?: boolean;
  unavailable?: boolean;
  count?: number;
};

function parseJson(body: string): unknown {
  return JSON.parse(body) as unknown;
}

function requireBestMatch(payload: MatchPayload): NonNullable<MatchPayload['bestMatch']> {
  assert.ok(payload.bestMatch);
  return payload.bestMatch;
}

void test('parsePlatformIdFromFolderName extracts trailing pid token', () => {
  assert.equal(parsePlatformIdFromFolderName('PlayStation 2__pid-8'), 8);
  assert.equal(parsePlatformIdFromFolderName('SNES__pid-19'), 19);
  assert.equal(parsePlatformIdFromFolderName('PS2'), null);
  assert.equal(parsePlatformIdFromFolderName('PS2__pid-0'), null);
});

void test('normalizeManualTitle removes punctuation and edition noise', () => {
  assert.equal(normalizeManualTitle('Chrono Trigger (USA) Rev A'), 'chrono trigger a');
  assert.equal(normalizeManualTitle('God of War II - Instruction Manual'), 'god of war ii');
  assert.equal(
    normalizeManualTitle('The Last Story (Collector Edition) Instruction Booklet'),
    'last story collector edition'
  );
});

void test('scoreManualTitleMatch prefers closer candidates', () => {
  const exact = scoreManualTitleMatch('Chrono Trigger', 'Chrono Trigger');
  const near = scoreManualTitleMatch('Chrono Trigger', 'Chrono Trigger DS');
  const far = scoreManualTitleMatch('Chrono Trigger', 'Final Fantasy X');

  assert.ok(exact > near);
  assert.ok(near > far);
  assert.ok(exact >= 0.9);
  assert.equal(scoreManualTitleMatch('abc def ghi jkl mno pqr', 'x'), 0);
  assert.equal(scoreManualTitleMatch('', ''), 0);
});

void test('resolve endpoint auto-matches when score and gap pass thresholds', async () => {
  const fixture = await buildFixtureTree();
  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: fixture.rootDir,
    manualsPublicBaseUrl: '/manuals'
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/manuals/resolve?igdbGameId=100&platformIgdbId=8&title=God%20of%20War%20II'
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as MatchPayload;
  assert.equal(payload.status, 'matched');
  const bestMatch = requireBestMatch(payload);
  assert.equal(bestMatch.source, 'fuzzy');
  assert.ok((bestMatch.relativePath ?? '').includes('PlayStation 2__pid-8/God of War II.pdf'));

  await app.close();
  await fs.rm(fixture.rootDir, { recursive: true, force: true });
});

void test('resolve endpoint returns none for ambiguous title', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manuals-ambiguous-'));
  await fs.mkdir(path.join(rootDir, 'PlayStation 2__pid-8'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/Resident Evil.pdf'), 'pdf');
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/Resident Evil 2.pdf'), 'pdf');

  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: rootDir,
    manualsPublicBaseUrl: '/manuals'
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/manuals/resolve?platformIgdbId=8&title=Resident'
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as MatchPayload;
  assert.equal(payload.status, 'none');
  assert.ok(Array.isArray(payload.candidates));
  assert.ok(payload.candidates.length >= 1);

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('search endpoint lists and ranks candidates by platform', async () => {
  const fixture = await buildFixtureTree();
  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: fixture.rootDir,
    manualsPublicBaseUrl: '/manuals'
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/manuals/search?platformIgdbId=8&q=god%20war'
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as SearchPayload;
  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.items.length >= 1);
  assert.ok((payload.items[0].relativePath ?? '').includes('PlayStation 2__pid-8'));

  await app.close();
  await fs.rm(fixture.rootDir, { recursive: true, force: true });
});

void test('resolve endpoint supports aliased platform ids using canonical manual folders', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manuals-alias-resolve-'));
  await fs.mkdir(path.join(rootDir, 'Nintendo Entertainment System__pid-18'), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, 'Nintendo Entertainment System__pid-18/Super Mario Bros.pdf'),
    'pdf'
  );

  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: rootDir,
    manualsPublicBaseUrl: '/manuals'
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/manuals/resolve?platformIgdbId=99&title=Super%20Mario%20Bros'
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as MatchPayload;
  assert.equal(payload.status, 'matched');
  const bestMatch = requireBestMatch(payload);
  assert.equal(bestMatch.platformIgdbId, 18);
  assert.ok(
    (bestMatch.relativePath ?? '').includes(
      'Nintendo Entertainment System__pid-18/Super Mario Bros.pdf'
    )
  );

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('search endpoint supports aliased platform ids using canonical manual folders', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manuals-alias-search-'));
  await fs.mkdir(path.join(rootDir, 'Nintendo Entertainment System__pid-18'), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, 'Nintendo Entertainment System__pid-18/The Legend of Zelda.pdf'),
    'pdf'
  );

  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: rootDir,
    manualsPublicBaseUrl: '/manuals'
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/manuals/search?platformIgdbId=51&q=zelda'
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as SearchPayload;
  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.items.length >= 1);
  assert.equal(payload.items[0].platformIgdbId, 18);
  assert.ok(
    (payload.items[0].relativePath ?? '').includes(
      'Nintendo Entertainment System__pid-18/The Legend of Zelda.pdf'
    )
  );

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('manual routes validate required platform id and unavailable catalogs', async () => {
  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: path.join(os.tmpdir(), `missing-manuals-${String(Date.now())}`),
    manualsPublicBaseUrl: '/manuals'
  });

  const missingPlatform = await app.inject({
    method: 'GET',
    url: '/v1/manuals/resolve?title=Anything'
  });
  assert.equal(missingPlatform.statusCode, 400);

  const unavailable = await app.inject({
    method: 'GET',
    url: '/v1/manuals/search?platformIgdbId=8&q=zelda'
  });
  assert.equal(unavailable.statusCode, 200);
  const unavailablePayload = parseJson(unavailable.body) as SearchPayload;
  assert.equal(unavailablePayload.unavailable, true);

  await app.close();
});

void test('manual resolve supports preferredRelativePath override and blank title behavior', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manuals-override-'));
  await fs.mkdir(path.join(rootDir, 'PlayStation 2__pid-8'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/Kingdom Hearts.pdf'), 'pdf');

  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: rootDir,
    manualsPublicBaseUrl: '/manuals/'
  });

  const override = await app.inject({
    method: 'GET',
    url: '/v1/manuals/resolve?platformIgdbId=8&preferredRelativePath=PlayStation%202__pid-8%2FKingdom%20Hearts.pdf'
  });
  assert.equal(override.statusCode, 200);
  const overridePayload = parseJson(override.body) as MatchPayload;
  assert.equal(overridePayload.status, 'matched');
  assert.equal(overridePayload.bestMatch?.source, 'override');

  const blankTitle = await app.inject({
    method: 'GET',
    url: '/v1/manuals/resolve?platformIgdbId=8&title='
  });
  assert.equal(blankTitle.statusCode, 200);
  const blankTitlePayload = parseJson(blankTitle.body) as MatchPayload;
  assert.equal(blankTitlePayload.status, 'none');

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('manual search returns sorted defaults and refresh supports force flag', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manuals-refresh-'));
  await fs.mkdir(path.join(rootDir, 'PlayStation 2__pid-8'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/B-Manual.pdf'), 'pdf');
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/A-Manual.pdf'), 'pdf');

  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: rootDir,
    manualsPublicBaseUrl: '/manuals'
  });

  const search = await app.inject({
    method: 'GET',
    url: '/v1/manuals/search?platformIgdbId=8'
  });
  assert.equal(search.statusCode, 200);
  const searchPayload = parseJson(search.body) as SearchPayload;
  assert.equal(searchPayload.items[0].fileName, 'A-Manual.pdf');
  assert.equal(searchPayload.items[1].fileName, 'B-Manual.pdf');

  const refresh = await app.inject({
    method: 'POST',
    url: '/v1/manuals/refresh?force=true'
  });
  assert.equal(refresh.statusCode, 200);
  const refreshPayload = parseJson(refresh.body) as RefreshPayload;
  assert.equal(refreshPayload.ok, true);
  assert.equal(refreshPayload.unavailable, false);
  assert.equal(refreshPayload.count, 2);

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('manual catalog cache requires force refresh to detect new files', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manuals-cache-'));
  await fs.mkdir(path.join(rootDir, 'PlayStation 2__pid-8'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/Initial.pdf'), 'pdf');

  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: rootDir,
    manualsPublicBaseUrl: '/manuals'
  });

  const before = await app.inject({
    method: 'GET',
    url: '/v1/manuals/search?platformIgdbId=8'
  });
  const beforePayload = parseJson(before.body) as SearchPayload;
  assert.equal(beforePayload.items.length, 1);

  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/AddedLater.pdf'), 'pdf');

  const cached = await app.inject({
    method: 'GET',
    url: '/v1/manuals/search?platformIgdbId=8'
  });
  const cachedPayload = parseJson(cached.body) as SearchPayload;
  assert.equal(cachedPayload.items.length, 1);

  const forced = await app.inject({
    method: 'POST',
    url: '/v1/manuals/refresh?force=1'
  });
  assert.equal(forced.statusCode, 200);

  const after = await app.inject({
    method: 'GET',
    url: '/v1/manuals/search?platformIgdbId=8'
  });
  const afterPayload = parseJson(after.body) as SearchPayload;
  assert.equal(afterPayload.items.length, 2);

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('manual routes set no-store cache headers', async () => {
  const fixture = await buildFixtureTree();
  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: fixture.rootDir,
    manualsPublicBaseUrl: '/manuals'
  });

  const resolve = await app.inject({
    method: 'GET',
    url: '/v1/manuals/resolve?platformIgdbId=8&title=God%20of%20War%20II'
  });
  assert.equal(resolve.statusCode, 200);
  assert.equal(resolve.headers['cache-control'], 'no-store, no-cache, must-revalidate');
  assert.equal(resolve.headers['pragma'], 'no-cache');
  assert.equal(resolve.headers['expires'], '0');

  const search = await app.inject({
    method: 'GET',
    url: '/v1/manuals/search?platformIgdbId=8&q=god%20war'
  });
  assert.equal(search.statusCode, 200);
  assert.equal(search.headers['cache-control'], 'no-store, no-cache, must-revalidate');

  const refresh = await app.inject({
    method: 'POST',
    url: '/v1/manuals/refresh?force=1'
  });
  assert.equal(refresh.statusCode, 200);
  assert.equal(refresh.headers['cache-control'], 'no-store, no-cache, must-revalidate');

  const invalid = await app.inject({
    method: 'GET',
    url: '/v1/manuals/resolve?title=MissingPlatform'
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.headers['cache-control'], 'no-store, no-cache, must-revalidate');

  await app.close();
  await fs.rm(fixture.rootDir, { recursive: true, force: true });
});

async function buildFixtureTree(): Promise<{ rootDir: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manuals-fixture-'));
  await fs.mkdir(path.join(rootDir, 'PlayStation 2__pid-8'), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'Nintendo Switch__pid-130'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/God of War II.pdf'), 'pdf');
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/God Hand.pdf'), 'pdf');
  await fs.writeFile(path.join(rootDir, 'Nintendo Switch__pid-130/Super Mario Odyssey.pdf'), 'pdf');
  return { rootDir };
}
