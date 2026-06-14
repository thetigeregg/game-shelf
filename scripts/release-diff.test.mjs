import assert from 'node:assert/strict';
import test from 'node:test';

import { listChangedFiles, readManifestDiff } from './release-diff.mjs';

test('listChangedFiles diffs head against parent when base is omitted', () => {
  const calls = [];
  const execFileSyncFn = (...args) => {
    calls.push(args);
    return 'src/app.ts\n';
  };

  const files = listChangedFiles({ head: 'v1.0.0', execFileSyncFn, cwd: '/repo' });

  assert.deepEqual(calls, [
    [
      'git',
      ['diff', '--name-only', 'v1.0.0^..v1.0.0'],
      { cwd: '/repo', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ],
  ]);
  assert.deepEqual(files, ['src/app.ts']);
});

test('readManifestDiff diffs head against parent when base is omitted', () => {
  const calls = [];
  const execFileSyncFn = (...args) => {
    calls.push(args);
    return '--- a/package.json\n+++ b/package.json\n';
  };

  const diff = readManifestDiff({
    head: 'HEAD',
    paths: ['package.json', 'package-lock.json'],
    execFileSyncFn,
    cwd: '/repo',
  });

  assert.deepEqual(calls, [
    [
      'git',
      ['diff', 'HEAD^..HEAD', '--', 'package.json', 'package-lock.json'],
      { cwd: '/repo', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ],
  ]);
  assert.match(diff, /package\.json/);
});
