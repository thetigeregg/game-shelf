import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { parseWorktreeFrontendPortOutput } from './scripts/resolve-worktree-frontend-port.mjs';

const resolveFrontendPortScript = fileURLToPath(
  new URL('./scripts/resolve-worktree-frontend-port.mjs', import.meta.url)
);

const playwrightEnv = {
  ...process.env,
  FEATURE_E2E_FIXTURES: 'true',
};

const frontendPortOutput = execFileSync(process.execPath, [resolveFrontendPortScript], {
  encoding: 'utf8',
  env: playwrightEnv,
});

const frontendPort = parseWorktreeFrontendPortOutput(frontendPortOutput);
const baseURL = `http://127.0.0.1:${String(frontendPort)}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx devx worktree frontend',
    env: playwrightEnv,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
