import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installSingleLineConsole } from './single-line-console.mjs';
import { resolvePlatform } from './registry.mjs';

function readEnvOrFile(name) {
  const filePath = String(process.env[`${name}_FILE`] ?? '').trim();
  const resolved = filePath.length > 0 ? filePath : `/run/secrets/${name.toLowerCase()}`;
  if (fs.existsSync(resolved)) {
    try {
      return fs.readFileSync(resolved, 'utf8').trim();
    } catch (error) {
      throw new Error(
        `Failed to read configuration secret for "${name}" from path "${resolved}": ${error.message}`
      );
    }
  }
  return '';
}

const app = express();
const port = Number.parseInt(process.env.PORT ?? '8791', 10);
const apiToken = readEnvOrFile('COMPAT_SCRAPER_TOKEN');
const browserTimeoutMs = Number.parseInt(process.env.COMPAT_SCRAPER_TIMEOUT_MS ?? '25000', 10);
const browserIdleTtlMs = Number.parseInt(process.env.COMPAT_SCRAPER_BROWSER_IDLE_MS ?? '30000', 10);
const compatDumpDir = process.env.COMPAT_DUMP_DIR ?? '/data/compat-dumps';
const debugLogsEnabled =
  String(process.env.DEBUG_COMPAT_SCRAPER_LOGS ?? '').toLowerCase() === 'true';
let sharedBrowser = null;
let sharedBrowserPromise = null;
let browserIdleTimer = null;
const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = path.resolve(fileURLToPath(import.meta.url));
const isMainModule = entrypointPath === modulePath;

installSingleLineConsole();

async function getSharedBrowser() {
  if (browserIdleTimer !== null) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }

  if (sharedBrowser) {
    return sharedBrowser;
  }

  if (!sharedBrowserPromise) {
    sharedBrowserPromise = chromium
      .launch({ headless: true })
      .then((browser) => {
        sharedBrowser = browser;
        sharedBrowserPromise = null;
        return browser;
      })
      .catch((error) => {
        sharedBrowserPromise = null;
        throw error;
      });
  }

  return sharedBrowserPromise;
}

function scheduleBrowserIdleClose() {
  if (browserIdleTimer !== null) {
    clearTimeout(browserIdleTimer);
  }

  browserIdleTimer = setTimeout(() => {
    closeSharedBrowser().catch((error) => {
      console.warn('[compat-scraper] browser_close_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, browserIdleTtlMs);
}

async function closeSharedBrowser() {
  if (browserIdleTimer !== null) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }

  if (!sharedBrowser) {
    return;
  }

  const browser = sharedBrowser;
  sharedBrowser = null;
  await browser.close();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/v1/compat/:platformIgdbId', async (req, res) => {
  if (apiToken.length > 0) {
    const authHeader = String(req.headers.authorization ?? '');
    const expectedHeader = `Bearer ${apiToken}`;

    if (authHeader !== expectedHeader) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const platformIgdbId = req.params.platformIgdbId;
  const platform = resolvePlatform(platformIgdbId);

  if (!platform) {
    res
      .status(404)
      .json({ error: `No compatibility source configured for platform ${platformIgdbId}.` });
    return;
  }

  try {
    // Parsers that need a live browser (none currently do) can call getSharedBrowser()
    // themselves; file-based parsers like Dolphin's ignore it entirely.
    const entries = await platform.parser.fetchList(getSharedBrowser, {
      platformSlug: platform.platformSlug,
      timeoutMs: browserTimeoutMs,
      dumpDir: compatDumpDir,
    });
    scheduleBrowserIdleClose();

    if (debugLogsEnabled) {
      console.info('[compat-scraper] fetched_list', {
        platformIgdbId,
        emulator: platform.emulator,
        entryCount: entries.length,
      });
    }

    res.json({
      emulator: platform.emulator,
      sourceUrl: platform.sourceUrl,
      fetchedAt: new Date().toISOString(),
      entries,
    });
  } catch (error) {
    console.error('[compat-scraper] request_failed', {
      platformIgdbId,
      message: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({ error: 'Unable to fetch compatibility data.' });
  }
});

if (isMainModule) {
  app.listen(port, () => {
    console.log(`[compat-scraper] listening on http://localhost:${port}`);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    closeSharedBrowser()
      .catch(() => {
        // Ignore shutdown cleanup errors.
      })
      .finally(() => {
        process.exit(0);
      });
  });
}
