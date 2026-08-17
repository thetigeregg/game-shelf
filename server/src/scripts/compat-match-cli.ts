import { createPool } from '../db.js';
import { config } from '../config.js';
import { isEmulationCompatStatus } from '../../../shared/emulation-compat-status.mjs';
import { COMPAT_PLATFORM_MAP } from '../emulation-compat/platform-map.js';

type Flags = Record<string, string | undefined>;

function parseIntFlag(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseFloatFlag(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseArgs(argv: string[]): { command: string; flags: Flags } {
  const rest = argv.slice(1);
  const flags: Flags = {};

  for (const arg of rest) {
    const match = /^--([a-zA-Z0-9]+)=(.*)$/.exec(arg);
    if (match) {
      flags[match[1]] = match[2];
    }
  }

  return { command: argv.length > 0 ? argv[0] : '', flags };
}

async function runCoverage(pool: import('pg').Pool): Promise<void> {
  const result = await pool.query<{
    platform_igdb_id: number;
    total_owned: string;
    matched: string;
    last_refreshed_at: string | null;
  }>(
    `
    SELECT
      g.platform_igdb_id,
      COUNT(*) AS total_owned,
      COUNT(ecs.igdb_game_id) AS matched,
      MAX(state.last_refreshed_at) AS last_refreshed_at
    FROM games g
    LEFT JOIN emulation_compat_status ecs
      ON ecs.igdb_game_id = g.igdb_game_id AND ecs.platform_igdb_id = g.platform_igdb_id
    LEFT JOIN emulation_compat_source_state state
      ON state.platform_igdb_id = g.platform_igdb_id
    WHERE (g.payload->>'listType') IN ('collection', 'wishlist')
      AND g.platform_igdb_id = ANY($1::int[])
    GROUP BY g.platform_igdb_id
    ORDER BY g.platform_igdb_id ASC
    `,
    [[...COMPAT_PLATFORM_MAP.keys()]]
  );

  for (const row of result.rows) {
    const platform = COMPAT_PLATFORM_MAP.get(row.platform_igdb_id);
    const total = Number.parseInt(row.total_owned, 10);
    const matched = Number.parseInt(row.matched, 10);
    console.log(
      `platform=${String(row.platform_igdb_id)} (${platform?.displayName ?? 'unknown'}) ` +
        `matched=${String(matched)}/${String(total)} missing=${String(total - matched)} ` +
        `lastRefreshedAt=${row.last_refreshed_at ?? 'never'}`
    );
  }
}

async function runList(pool: import('pg').Pool, flags: Flags): Promise<void> {
  const platformFilter = parseIntFlag(flags.platform);
  const state = flags.state ?? 'missing';
  const maxConfidence = parseFloatFlag(flags.maxConfidence);

  if (state === 'missing') {
    const result = await pool.query<{
      igdb_game_id: string;
      platform_igdb_id: number;
      title: string;
    }>(
      `
      SELECT g.igdb_game_id, g.platform_igdb_id, BTRIM(COALESCE(g.payload->>'title', '')) AS title
      FROM games g
      LEFT JOIN emulation_compat_status ecs
        ON ecs.igdb_game_id = g.igdb_game_id AND ecs.platform_igdb_id = g.platform_igdb_id
      WHERE (g.payload->>'listType') IN ('collection', 'wishlist')
        AND g.platform_igdb_id = ANY($1::int[])
        AND ($2::int IS NULL OR g.platform_igdb_id = $2)
        AND ecs.igdb_game_id IS NULL
      ORDER BY g.platform_igdb_id ASC, title ASC
      `,
      [[...COMPAT_PLATFORM_MAP.keys()], platformFilter]
    );
    for (const row of result.rows) {
      console.log(
        `MISSING game=${row.igdb_game_id} platform=${String(row.platform_igdb_id)} title="${row.title}"`
      );
    }
    return;
  }

  if (state === 'low-confidence') {
    const threshold = maxConfidence ?? 100;
    const result = await pool.query<{
      igdb_game_id: string;
      platform_igdb_id: number;
      match_query_title: string | null;
      normalized_status: string;
      raw_label: string;
      match_confidence: string | null;
    }>(
      `
      SELECT igdb_game_id, platform_igdb_id, match_query_title, normalized_status, raw_label, match_confidence
      FROM emulation_compat_status
      WHERE match_locked = FALSE
        AND ($1::int IS NULL OR platform_igdb_id = $1)
        AND (match_confidence IS NULL OR match_confidence < $2)
      ORDER BY match_confidence ASC NULLS FIRST
      `,
      [platformFilter, threshold]
    );
    for (const row of result.rows) {
      console.log(
        `LOW_CONFIDENCE game=${row.igdb_game_id} platform=${String(row.platform_igdb_id)} ` +
          `title="${row.match_query_title ?? ''}" status=${row.normalized_status} rawLabel="${row.raw_label}" ` +
          `confidence=${row.match_confidence ?? 'null'}`
      );
    }
    return;
  }

  console.error(`Unknown --state="${state}". Expected "missing" or "low-confidence".`);
  process.exitCode = 1;
}

async function runSet(pool: import('pg').Pool, flags: Flags): Promise<void> {
  const igdbGameId = flags.game;
  const platformIgdbId = parseIntFlag(flags.platform);
  const status = flags.status;
  const rawLabel = flags.label ?? status;

  if (!igdbGameId || platformIgdbId === null || !isEmulationCompatStatus(status)) {
    console.error(
      'Usage: compat:match set --game=<igdbGameId> --platform=<platformIgdbId> --status=<perfect|playable|incomplete> [--label=<raw>]'
    );
    process.exitCode = 1;
    return;
  }

  const platform = COMPAT_PLATFORM_MAP.get(platformIgdbId);
  if (!platform) {
    console.error(`Platform ${String(platformIgdbId)} is not compat-eligible.`);
    process.exitCode = 1;
    return;
  }

  await pool.query(
    `
    INSERT INTO emulation_compat_status (
      igdb_game_id, platform_igdb_id, emulator, normalized_status, raw_label,
      match_locked, enrichment_retry, matched_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, TRUE, '{}'::jsonb, NOW(), NOW())
    ON CONFLICT (igdb_game_id, platform_igdb_id) DO UPDATE SET
      normalized_status = EXCLUDED.normalized_status,
      raw_label = EXCLUDED.raw_label,
      match_locked = TRUE,
      enrichment_retry = '{}'::jsonb,
      matched_at = NOW(),
      updated_at = NOW()
    `,
    [igdbGameId, platformIgdbId, platform.emulator, status, rawLabel ?? status]
  );

  console.log(
    `Set game=${igdbGameId} platform=${String(platformIgdbId)} status=${status} (locked).`
  );
}

async function runClear(pool: import('pg').Pool, flags: Flags): Promise<void> {
  const igdbGameId = flags.game;
  const platformIgdbId = parseIntFlag(flags.platform);

  if (!igdbGameId || platformIgdbId === null) {
    console.error('Usage: compat:match clear --game=<igdbGameId> --platform=<platformIgdbId>');
    process.exitCode = 1;
    return;
  }

  const result = await pool.query(
    `UPDATE emulation_compat_status SET match_locked = FALSE, updated_at = NOW()
     WHERE igdb_game_id = $1 AND platform_igdb_id = $2`,
    [igdbGameId, platformIgdbId]
  );

  console.log(
    result.rowCount && result.rowCount > 0
      ? `Cleared manual lock for game=${igdbGameId} platform=${String(platformIgdbId)}.`
      : `No row found for game=${igdbGameId} platform=${String(platformIgdbId)}.`
  );
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const pool = await createPool(config.postgresUrl);

  try {
    switch (command) {
      case 'coverage':
        await runCoverage(pool);
        break;
      case 'list':
        await runList(pool, flags);
        break;
      case 'set':
        await runSet(pool, flags);
        break;
      case 'clear':
        await runClear(pool, flags);
        break;
      default:
        console.error('Usage: compat:match <coverage|list|set|clear> [--flags]');
        process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
