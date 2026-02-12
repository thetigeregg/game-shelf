import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { normalizeManualTitle, parsePlatformIdFromFolderName, registerManualRoutes, scoreManualTitleMatch } from './manuals.js';

test('parsePlatformIdFromFolderName extracts trailing pid token', () => {
  assert.equal(parsePlatformIdFromFolderName('PlayStation 2__pid-8'), 8);
  assert.equal(parsePlatformIdFromFolderName('SNES__pid-19'), 19);
  assert.equal(parsePlatformIdFromFolderName('PS2'), null);
  assert.equal(parsePlatformIdFromFolderName('PS2__pid-0'), null);
});

test('normalizeManualTitle removes punctuation and edition noise', () => {
  assert.equal(normalizeManualTitle('Chrono Trigger (USA) Rev A'), 'chrono trigger a');
  assert.equal(normalizeManualTitle('God of War II - Instruction Manual'), 'god of war ii');
});

test('scoreManualTitleMatch prefers closer candidates', () => {
  const exact = scoreManualTitleMatch('Chrono Trigger', 'Chrono Trigger');
  const near = scoreManualTitleMatch('Chrono Trigger', 'Chrono Trigger DS');
  const far = scoreManualTitleMatch('Chrono Trigger', 'Final Fantasy X');

  assert.ok(exact > near);
  assert.ok(near > far);
  assert.ok(exact >= 0.9);
});

test('resolve endpoint auto-matches when score and gap pass thresholds', async () => {
  const fixture = await buildFixtureTree();
  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: fixture.rootDir,
    manualsPublicBaseUrl: '/manuals',
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/manuals/resolve?igdbGameId=100&platformIgdbId=8&title=God%20of%20War%20II',
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as Record<string, any>;
  assert.equal(payload.status, 'matched');
  assert.equal(payload.bestMatch?.source, 'fuzzy');
  assert.ok(String(payload.bestMatch?.relativePath ?? '').includes('PlayStation 2__pid-8/God of War II.pdf'));

  await app.close();
  await fs.rm(fixture.rootDir, { recursive: true, force: true });
});

test('resolve endpoint returns none for ambiguous title', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manuals-ambiguous-'));
  await fs.mkdir(path.join(rootDir, 'PlayStation 2__pid-8'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/Resident Evil.pdf'), 'pdf');
  await fs.writeFile(path.join(rootDir, 'PlayStation 2__pid-8/Resident Evil 2.pdf'), 'pdf');

  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: rootDir,
    manualsPublicBaseUrl: '/manuals',
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/manuals/resolve?platformIgdbId=8&title=Resident',
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as Record<string, any>;
  assert.equal(payload.status, 'none');
  assert.ok(Array.isArray(payload.candidates));
  assert.ok(payload.candidates.length >= 1);

  await app.close();
  await fs.rm(rootDir, { recursive: true, force: true });
});

test('search endpoint lists and ranks candidates by platform', async () => {
  const fixture = await buildFixtureTree();
  const app = Fastify();
  registerManualRoutes(app, {
    manualsDir: fixture.rootDir,
    manualsPublicBaseUrl: '/manuals',
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/manuals/search?platformIgdbId=8&q=god%20war',
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as Record<string, any>;
  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.items.length >= 1);
  assert.ok(String(payload.items[0].relativePath).includes('PlayStation 2__pid-8'));

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
