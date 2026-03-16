import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

void test('config clamps popularity feed row limit to a sane maximum', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-shelf-config-'));
  const envFile = path.join(tempDir, '.env');

  fs.writeFileSync(envFile, 'POPULARITY_FEED_ROW_LIMIT=999\n', 'utf8');

  const originalEnvFile = process.env.ENV_FILE;
  const originalPopularityFeedRowLimit = process.env.POPULARITY_FEED_ROW_LIMIT;
  process.env.ENV_FILE = envFile;
  delete process.env.POPULARITY_FEED_ROW_LIMIT;

  try {
    const moduleUrl = pathToFileURL(path.resolve(process.cwd(), 'src/config.ts')).href;
    const imported = (await import(`${moduleUrl}?case=popularity-row-limit-clamp`)) as {
      config: { popularityFeedRowLimit: number };
    };

    assert.equal(imported.config.popularityFeedRowLimit, 200);
  } finally {
    if (typeof originalEnvFile === 'string') {
      process.env.ENV_FILE = originalEnvFile;
    } else {
      delete process.env.ENV_FILE;
    }
    if (typeof originalPopularityFeedRowLimit === 'string') {
      process.env.POPULARITY_FEED_ROW_LIMIT = originalPopularityFeedRowLimit;
    } else {
      delete process.env.POPULARITY_FEED_ROW_LIMIT;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
