import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const serverRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configModuleUrl = new URL('./config.ts', import.meta.url).href;

void test('config clamps popularity feed row limit to a sane maximum', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-shelf-config-'));
  const envFile = path.join(tempDir, '.env');

  fs.writeFileSync(envFile, 'POPULARITY_FEED_ROW_LIMIT=999\n', 'utf8');

  try {
    const env = {
      ...process.env,
      DOTENV_CONFIG_QUIET: 'true',
      ENV_FILE: envFile,
      NODE_ENV: 'test'
    };
    delete env.POPULARITY_FEED_ROW_LIMIT;

    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        `
          const imported = await import(${JSON.stringify(
            `${configModuleUrl}?case=popularity-row-limit-clamp`
          )});
          process.stdout.write(JSON.stringify(imported.config.popularityFeedRowLimit));
        `
      ],
      {
        cwd: serverRootDir,
        env,
        encoding: 'utf8'
      }
    );

    assert.equal(child.status, 0, child.stderr || child.stdout);
    const outputMatch = child.stdout.match(/(\d+)\s*$/);
    assert.equal(outputMatch?.[1], '200', child.stdout || child.stderr);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
