import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { buildAuditArgs, isEntrypoint, runAudit, runAudits } from './audit-all.mjs';

test('buildAuditArgs uses the repo root prefix for nested projects', () => {
  assert.deepEqual(buildAuditArgs('.', false, '/repo'), ['audit']);
  assert.deepEqual(buildAuditArgs('.', true, '/repo'), ['audit', 'fix']);
  assert.deepEqual(buildAuditArgs('server', false, '/repo'), [
    '--prefix',
    path.resolve('/repo', 'server'),
    'audit',
  ]);
  assert.deepEqual(buildAuditArgs('worker', true, '/repo'), [
    '--prefix',
    path.resolve('/repo', 'worker'),
    'audit',
    'fix',
  ]);
});

test('runAudit reports spawn errors as failures', () => {
  const logs = [];
  const errors = [];

  const result = runAudit(
    { name: 'server', path: 'server' },
    {
      repoRoot: '/repo',
      npmCommand: 'npm',
      spawn: () => ({ error: new Error('spawn failed') }),
      log: (message) => logs.push(message),
      errorLog: (message) => errors.push(message),
    }
  );

  assert.equal(result.name, 'server');
  assert.equal(result.exitCode, 1);
  assert.match(logs.at(-1), /Running: npm --prefix \/repo\/server audit$/);
  assert.deepEqual(errors, ['❌ server failed to run', 'spawn failed']);
});

test('runAudits aggregates non-zero exits and returns a failing exit code', () => {
  const logs = [];
  const errors = [];
  const calls = [];
  const exitCodes = new Map([
    ['root', 0],
    ['worker', 3],
  ]);

  const result = runAudits({
    projects: [
      { name: 'root', path: '.' },
      { name: 'worker', path: 'worker' },
    ],
    repoRoot: '/repo',
    npmCommand: 'npm',
    shouldFix: true,
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      const projectName = args.includes('--prefix') ? 'worker' : 'root';
      return { status: exitCodes.get(projectName) };
    },
    log: (message) => logs.push(message),
    errorLog: (message) => errors.push(message),
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.failures, [{ name: 'worker', exitCode: 3 }]);
  assert.deepEqual(calls, [
    {
      command: 'npm',
      args: ['audit', 'fix'],
      options: { cwd: '/repo', stdio: 'inherit' },
    },
    {
      command: 'npm',
      args: ['--prefix', path.resolve('/repo', 'worker'), 'audit', 'fix'],
      options: { cwd: '/repo', stdio: 'inherit' },
    },
  ]);
  assert.equal(logs.at(-1)?.includes('completed successfully'), false);
  assert.deepEqual(errors.slice(-2), [
    '\n⚠️ Audit fix completed with remaining failures:',
    '- worker (exit code 3)',
  ]);
});

test('isEntrypoint resolves relative script paths before comparing module urls', () => {
  assert.equal(
    isEntrypoint({
      argv1: 'scripts/audit-all.mjs',
      moduleUrl: new URL('./audit-all.mjs', import.meta.url).href,
    }),
    true
  );
});

test('isEntrypoint returns false when argv[1] is missing', () => {
  assert.equal(
    isEntrypoint({
      argv1: undefined,
      moduleUrl: new URL('./audit-all.mjs', import.meta.url).href,
    }),
    false
  );
});
