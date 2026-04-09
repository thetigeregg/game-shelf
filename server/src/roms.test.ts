import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import {
  normalizeRomTitle,
  parseRomFileName,
  parsePlatformIdFromFolderName,
  processQueuedRomsCatalogRefresh,
  registerRomRoutes,
  scoreRomTitleMatch,
} from './roms.js';

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

class SettingsPoolMock {
  private settingValue: string | null = null;

  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: Array<{ setting_value: string }>; rowCount: number }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.startsWith('insert into settings')) {
      this.settingValue = typeof params?.[1] === 'string' ? params[1] : null;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (normalized.startsWith('select setting_value from settings')) {
      if (!this.settingValue) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({
        rows: [{ setting_value: this.settingValue }],
        rowCount: 1,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
}

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

void test('normalizeRomTitle strips metadata and normalizes first subtitle separator', () => {
  assert.equal(normalizeRomTitle('Banjo-Kazooie (USA) (Rev 1).z64'), 'banjo kazooie');
  assert.equal(normalizeRomTitle('Chrono Trigger (USA) Rev A.sfc'), 'chrono trigger a');
  assert.equal(normalizeRomTitle('Among Us (USA).nsp'), 'among us');
  assert.equal(
    normalizeRomTitle('Ace Attorney Investigations - Miles Edgeworth (USA).nds'),
    'ace attorney investigations miles edgeworth'
  );
  assert.equal(
    normalizeRomTitle('Boktai - The Sun Is in Your Hand (USA).gba'),
    'boktai sun is in your hand'
  );
  assert.equal(
    normalizeRomTitle(
      'Cardcaptor Sakura - Sakura Card Hen - Sakura to Card to Otomodachi (Japan) (Rev 1).gba'
    ),
    'cardcaptor sakura sakura card hen sakura to card to otomodachi'
  );
  assert.equal(normalizeRomTitle('Combat ~ Tank-Plus (USA).a26'), 'combat tank plus');
  assert.equal(
    normalizeRomTitle('R.B.I. Baseball (Tengen) [hM04] (Unl).nes'),
    'r b i baseball tengen'
  );
});

void test('parseRomFileName extracts clean title and metadata', () => {
  const banjo = parseRomFileName('Banjo-Kazooie (USA) (Rev 1).z64');
  assert.deepEqual(banjo, {
    raw: 'Banjo-Kazooie (USA) (Rev 1).z64',
    title: 'Banjo-Kazooie',
    extension: 'z64',
    region: 'USA',
    revision: 'Rev 1',
    flags: [],
  });

  const sakura = parseRomFileName(
    'Cardcaptor Sakura - Sakura Card Hen - Sakura to Card to Otomodachi (Japan) (Rev 1).gba'
  );
  assert.equal(sakura.title, 'Cardcaptor Sakura: Sakura Card Hen - Sakura to Card to Otomodachi');
  assert.equal(sakura.region, 'Japan');
  assert.equal(sakura.revision, 'Rev 1');

  const harvest = parseRomFileName('Harvest Moon GBC (USA) (SGB Enhanced) (GB Compatible).gbc');
  assert.equal(harvest.title, 'Harvest Moon GBC');
  assert.equal(harvest.region, 'USA');
  assert.deepEqual(harvest.flags, ['SGB Enhanced', 'GB Compatible']);

  const copyArtifact = parseRomFileName('Boktai - The Sun Is in Your Hand (USA).gba copy');
  assert.equal(copyArtifact.title, 'Boktai: The Sun Is in Your Hand');
  assert.equal(copyArtifact.extension, null);

  const tengen = parseRomFileName('R.B.I. Baseball (Tengen) [hM04] (Unl).nes');
  assert.equal(tengen.title, 'R.B.I. Baseball (Tengen)');
  assert.equal(tengen.region, 'Unl');
  assert.deepEqual(tengen.flags, ['hM04']);

  const chrono = parseRomFileName('Chrono Trigger (USA) Rev A.sfc');
  assert.equal(chrono.title, 'Chrono Trigger (USA) Rev A');
  assert.equal(chrono.extension, 'sfc');
  assert.equal(chrono.region, null);
  assert.equal(chrono.revision, null);

  const collectorEdition = parseRomFileName('The Last Story (Collector Edition).iso');
  assert.equal(collectorEdition.title, 'The Last Story (Collector Edition)');
  assert.equal(collectorEdition.region, null);
  assert.equal(collectorEdition.revision, null);
  assert.deepEqual(collectorEdition.flags, []);

  const dotPrefixedTitle = parseRomFileName('.hack');
  assert.equal(dotPrefixedTitle.title, '.hack');
  assert.equal(dotPrefixedTitle.extension, null);
});

void test('scoreRomTitleMatch prefers closer candidates', () => {
  const exact = scoreRomTitleMatch('Chrono Trigger', 'Chrono Trigger');
  const near = scoreRomTitleMatch('Chrono Trigger', 'Chrono Trigger DS');
  const far = scoreRomTitleMatch('Chrono Trigger', 'Final Fantasy X');

  assert.ok(exact > near);
  assert.ok(near > far);
  assert.ok(exact >= 0.9);
  assert.equal(scoreRomTitleMatch('abc def ghi jkl mno pqr', 'x'), 0);
  assert.equal(scoreRomTitleMatch('', ''), 0);
});

void test('resolve endpoint auto-matches when score and gap pass thresholds', async () => {
  const fixture = await buildFixtureTree();
  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: fixture.rootDir,
    romsPublicBaseUrl: '/roms',
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/roms/resolve?igdbGameId=100&platformIgdbId=8&title=God%20of%20War%20II',
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as MatchPayload;
  assert.equal(payload.status, 'matched');
  const bestMatch = requireBestMatch(payload);
  assert.equal(bestMatch.source, 'fuzzy');
  assert.ok((bestMatch.relativePath ?? '').includes('PlayStation 2__pid-8/God of War II.bin'));

  await app.close();
  await fs.rm(fixture.rootDir, { recursive: true, force: true });
});

void test('resolve endpoint returns none for ambiguous title', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roms-ambiguous-'));
  await fs.mkdir(path.join(rootDir, 'PlayStation 2__pid-8'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/Resident Evil.bin'), 'pdf');
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/Resident Evil 2.bin'), 'pdf');

  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: rootDir,
    romsPublicBaseUrl: '/roms',
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/roms/resolve?platformIgdbId=8&title=Resident',
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as MatchPayload;
  assert.equal(payload.status, 'none');
  assert.ok(Array.isArray(payload.candidates));
  assert.ok(payload.candidates.length >= 1);

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('resolve endpoint returns none when no candidates score above zero', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roms-zero-score-'));
  await fs.mkdir(path.join(rootDir, 'Nintendo Entertainment System__pid-18'), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, 'Nintendo Entertainment System__pid-18/Bubble Bobble.nes'),
    'rom'
  );

  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: rootDir,
    romsPublicBaseUrl: '/roms',
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/roms/resolve?platformIgdbId=18&title=zzzzzzzz',
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as MatchPayload;
  assert.equal(payload.status, 'none');
  assert.deepEqual(payload.candidates, []);

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('resolve does not auto-match files inside multi-file folders', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roms-multifile-no-auto-'));
  await fs.mkdir(path.join(rootDir, 'Sony PlayStation__pid-7/Metal Gear Solid (USA)'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(rootDir, 'Sony PlayStation__pid-7/Metal Gear Solid (USA)/Metal Gear Solid.cue'),
    'pdf'
  );
  await fs.writeFile(
    path.join(rootDir, 'Sony PlayStation__pid-7/Metal Gear Solid (USA)/Metal Gear Solid.bin'),
    'pdf'
  );

  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: rootDir,
    romsPublicBaseUrl: '/roms',
  });

  const resolve = await app.inject({
    method: 'GET',
    url: '/v1/roms/resolve?platformIgdbId=7&title=Metal%20Gear%20Solid',
  });
  assert.equal(resolve.statusCode, 200);
  const resolvePayload = parseJson(resolve.body) as MatchPayload;
  assert.equal(resolvePayload.status, 'none');
  assert.ok(Array.isArray(resolvePayload.candidates));
  assert.ok(resolvePayload.candidates.length >= 1);

  const search = await app.inject({
    method: 'GET',
    url: '/v1/roms/search?platformIgdbId=7&q=Metal%20Gear%20Solid',
  });
  assert.equal(search.statusCode, 200);
  const searchPayload = parseJson(search.body) as SearchPayload;
  assert.ok(searchPayload.items.some((item) => (item.relativePath ?? '').endsWith('.cue')));
  assert.ok(searchPayload.items.some((item) => (item.relativePath ?? '').endsWith('.bin')));

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('search endpoint lists and ranks candidates by platform', async () => {
  const fixture = await buildFixtureTree();
  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: fixture.rootDir,
    romsPublicBaseUrl: '/roms',
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/roms/search?platformIgdbId=8&q=god%20war',
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as SearchPayload;
  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.items.length >= 1);
  assert.ok((payload.items[0].relativePath ?? '').includes('PlayStation 2__pid-8'));

  await app.close();
  await fs.rm(fixture.rootDir, { recursive: true, force: true });
});

void test('resolve endpoint supports aliased platform ids using canonical rom folders', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roms-alias-resolve-'));
  await fs.mkdir(path.join(rootDir, 'Nintendo Entertainment System__pid-18'), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, 'Nintendo Entertainment System__pid-18/Super Mario Bros.bin'),
    'pdf'
  );

  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: rootDir,
    romsPublicBaseUrl: '/roms',
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/roms/resolve?platformIgdbId=99&title=Super%20Mario%20Bros',
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as MatchPayload;
  assert.equal(payload.status, 'matched');
  const bestMatch = requireBestMatch(payload);
  assert.equal(bestMatch.platformIgdbId, 18);
  assert.ok(
    (bestMatch.relativePath ?? '').includes(
      'Nintendo Entertainment System__pid-18/Super Mario Bros.bin'
    )
  );

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('search endpoint supports aliased platform ids using canonical rom folders', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roms-alias-search-'));
  await fs.mkdir(path.join(rootDir, 'Nintendo Entertainment System__pid-18'), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, 'Nintendo Entertainment System__pid-18/The Legend of Zelda.bin'),
    'pdf'
  );

  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: rootDir,
    romsPublicBaseUrl: '/roms',
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/roms/search?platformIgdbId=51&q=zelda',
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as SearchPayload;
  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.items.length >= 1);
  assert.equal(payload.items[0].platformIgdbId, 18);
  assert.ok(
    (payload.items[0].relativePath ?? '').includes(
      'Nintendo Entertainment System__pid-18/The Legend of Zelda.bin'
    )
  );

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('rom routes validate required platform id and unavailable catalogs', async () => {
  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: path.join(os.tmpdir(), `missing-roms-${String(Date.now())}`),
    romsPublicBaseUrl: '/roms',
  });

  const missingPlatform = await app.inject({
    method: 'GET',
    url: '/v1/roms/resolve?title=Anything',
  });
  assert.equal(missingPlatform.statusCode, 400);

  const unavailable = await app.inject({
    method: 'GET',
    url: '/v1/roms/search?platformIgdbId=8&q=zelda',
  });
  assert.equal(unavailable.statusCode, 200);
  const unavailablePayload = parseJson(unavailable.body) as SearchPayload;
  assert.equal(unavailablePayload.unavailable, true);

  await app.close();
});

void test('rom resolve supports preferredRelativePath override and blank title behavior', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roms-override-'));
  await fs.mkdir(path.join(rootDir, 'PlayStation 2__pid-8'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/Kingdom Hearts.bin'), 'pdf');

  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: rootDir,
    romsPublicBaseUrl: '/roms/',
  });

  const override = await app.inject({
    method: 'GET',
    url: '/v1/roms/resolve?platformIgdbId=8&preferredRelativePath=PlayStation%202__pid-8%2FKingdom%20Hearts.bin',
  });
  assert.equal(override.statusCode, 200);
  const overridePayload = parseJson(override.body) as MatchPayload;
  assert.equal(overridePayload.status, 'matched');
  assert.equal(overridePayload.bestMatch?.source, 'override');

  const blankTitle = await app.inject({
    method: 'GET',
    url: '/v1/roms/resolve?platformIgdbId=8&title=',
  });
  assert.equal(blankTitle.statusCode, 200);
  const blankTitlePayload = parseJson(blankTitle.body) as MatchPayload;
  assert.equal(blankTitlePayload.status, 'none');

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('rom search returns sorted defaults and refresh supports force flag', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roms-refresh-'));
  await fs.mkdir(path.join(rootDir, 'PlayStation 2__pid-8'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/B-Rom.bin'), 'pdf');
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/A-Rom.bin'), 'pdf');

  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: rootDir,
    romsPublicBaseUrl: '/roms',
  });

  const search = await app.inject({
    method: 'GET',
    url: '/v1/roms/search?platformIgdbId=8',
  });
  assert.equal(search.statusCode, 200);
  const searchPayload = parseJson(search.body) as SearchPayload;
  assert.equal(searchPayload.items[0].fileName, 'A-Rom.bin');
  assert.equal(searchPayload.items[1].fileName, 'B-Rom.bin');

  const refresh = await app.inject({
    method: 'POST',
    url: '/v1/roms/refresh?force=true',
  });
  assert.equal(refresh.statusCode, 200);
  const refreshPayload = parseJson(refresh.body) as RefreshPayload;
  assert.equal(refreshPayload.ok, true);
  assert.equal(refreshPayload.unavailable, false);
  assert.equal(refreshPayload.count, 2);

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('rom catalog cache requires force refresh to detect new files', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roms-cache-'));
  await fs.mkdir(path.join(rootDir, 'PlayStation 2__pid-8'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/Initial.bin'), 'pdf');

  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: rootDir,
    romsPublicBaseUrl: '/roms',
  });

  const before = await app.inject({
    method: 'GET',
    url: '/v1/roms/search?platformIgdbId=8',
  });
  const beforePayload = parseJson(before.body) as SearchPayload;
  assert.equal(beforePayload.items.length, 1);

  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/AddedLater.bin'), 'pdf');

  const cached = await app.inject({
    method: 'GET',
    url: '/v1/roms/search?platformIgdbId=8',
  });
  const cachedPayload = parseJson(cached.body) as SearchPayload;
  assert.equal(cachedPayload.items.length, 1);

  const forced = await app.inject({
    method: 'POST',
    url: '/v1/roms/refresh?force=1',
  });
  assert.equal(forced.statusCode, 200);

  const after = await app.inject({
    method: 'GET',
    url: '/v1/roms/search?platformIgdbId=8',
  });
  const afterPayload = parseJson(after.body) as SearchPayload;
  assert.equal(afterPayload.items.length, 2);

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

void test('rom routes set no-store cache headers', async () => {
  const fixture = await buildFixtureTree();
  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: fixture.rootDir,
    romsPublicBaseUrl: '/roms',
  });

  const resolve = await app.inject({
    method: 'GET',
    url: '/v1/roms/resolve?platformIgdbId=8&title=God%20of%20War%20II',
  });
  assert.equal(resolve.statusCode, 200);
  assert.equal(resolve.headers['cache-control'], 'no-store, no-cache, must-revalidate');
  assert.equal(resolve.headers['pragma'], 'no-cache');
  assert.equal(resolve.headers['expires'], '0');

  const search = await app.inject({
    method: 'GET',
    url: '/v1/roms/search?platformIgdbId=8&q=god%20war',
  });
  assert.equal(search.statusCode, 200);
  assert.equal(search.headers['cache-control'], 'no-store, no-cache, must-revalidate');

  const refresh = await app.inject({
    method: 'POST',
    url: '/v1/roms/refresh?force=1',
  });
  assert.equal(refresh.statusCode, 200);
  assert.equal(refresh.headers['cache-control'], 'no-store, no-cache, must-revalidate');

  const invalid = await app.inject({
    method: 'GET',
    url: '/v1/roms/resolve?title=MissingPlatform',
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.headers['cache-control'], 'no-store, no-cache, must-revalidate');

  await app.close();
  await fs.rm(fixture.rootDir, { recursive: true, force: true });
});

void test('queue snapshot round-trip preserves trigram-based rom matching', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roms-queue-snapshot-'));
  await fs.mkdir(path.join(rootDir, 'PlayStation 2__pid-8'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/God of War II.bin'), 'pdf');

  const queuePool = new SettingsPoolMock();
  await processQueuedRomsCatalogRefresh(queuePool as never, rootDir);

  const app = Fastify();
  registerRomRoutes(app, {
    romsDir: rootDir,
    romsPublicBaseUrl: '/roms',
    mode: 'queue',
    queuePool: queuePool as never,
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/roms/resolve?platformIgdbId=8&title=God%20of%20War%20II',
  });
  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as MatchPayload;
  assert.equal(payload.status, 'matched');

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

async function buildFixtureTree(): Promise<{ rootDir: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roms-fixture-'));
  await fs.mkdir(path.join(rootDir, 'PlayStation 2__pid-8'), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'Nintendo Switch__pid-130'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/God of War II.bin'), 'pdf');
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/God Hand.bin'), 'pdf');
  await fs.writeFile(path.join(rootDir, 'Nintendo Switch__pid-130/Super Mario Odyssey.bin'), 'pdf');
  return { rootDir };
}
