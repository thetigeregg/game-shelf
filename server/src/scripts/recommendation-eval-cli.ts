/**
 * Offline leave-one-out evaluation of BACKLOG recommendations.
 *
 * Usage:
 *   npm run rec:eval -- --input=/path/to/rec-eval-export.json [--mode=NEUTRAL] [--k=10,20,50]
 *                       [--json] [--<scoringOption>=<number> ...]
 *
 * The input file is a JSON object of the form
 *   { "games": [{ "igdb_game_id", "platform_igdb_id", "payload" }],
 *     "embeddings": [{ "igdb_game_id", "platform_igdb_id", "embedding" }] }
 * which the export query in docs/recommendation-evaluation.md produces.
 *
 * Scoring options default to RECOMMENDATION_SCORING_DEFAULTS. Production can
 * override them through RECOMMENDATIONS_* env vars, so pass the same values as
 * flags (e.g. --semanticWeight=1.5) to mirror a customised deployment.
 */
import fs from 'node:fs';
import { buildKeywordArtifacts } from '../recommendations/keyword-stats.js';
import { evaluateRecommendationQuality } from '../recommendations/evaluation.js';
import { normalizeDbGameRow } from '../recommendations/normalize.js';
import { parseEmbeddingVector } from '../recommendations/repository.js';
import { parseRecommendationRuntimeMode } from '../recommendations/runtime.js';
import {
  RECOMMENDATION_KEYWORD_SELECTION_DEFAULTS,
  RECOMMENDATION_SCORING_DEFAULTS,
} from '../recommendations/scoring-defaults.js';
import { buildGameKey } from '../recommendations/semantic.js';
import type { NormalizedGameRecord } from '../recommendations/types.js';
import type { RecommendationScoringOptions } from '../recommendations/pipeline.js';

interface ExportRow {
  igdb_game_id?: unknown;
  platform_igdb_id?: unknown;
  payload?: unknown;
  embedding?: unknown;
}

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue;
    }

    const body = arg.slice(2);
    const separator = body.indexOf('=');
    if (separator < 0) {
      flags.set(body, 'true');
    } else {
      flags.set(body.slice(0, separator), body.slice(separator + 1));
    }
  }

  return flags;
}

function readScoringOptions(flags: Map<string, string>): RecommendationScoringOptions {
  const options: RecommendationScoringOptions = { ...RECOMMENDATION_SCORING_DEFAULTS };

  for (const key of Object.keys(options) as Array<keyof RecommendationScoringOptions>) {
    const raw = flags.get(key);
    if (raw === undefined) {
      continue;
    }

    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`--${key} must be a number, received "${raw}".`);
    }
    options[key] = parsed;
  }

  return options;
}

function readExport(path: string): { games: ExportRow[]; embeddings: ExportRow[] } {
  const parsed = JSON.parse(fs.readFileSync(path, 'utf8')) as unknown;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Export file must contain a JSON object.');
  }

  const record = parsed as { games?: unknown; embeddings?: unknown };

  return {
    games: Array.isArray(record.games) ? (record.games as ExportRow[]) : [],
    embeddings: Array.isArray(record.embeddings) ? (record.embeddings as ExportRow[]) : [],
  };
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const input = flags.get('input');

  if (!input || input === 'true') {
    throw new Error('Pass --input=<path to export JSON>.');
  }

  const runtimeMode = parseRecommendationRuntimeMode(flags.get('mode') ?? 'NEUTRAL');
  if (!runtimeMode) {
    throw new Error('--mode must be NEUTRAL, SHORT or LONG.');
  }

  const ks = (flags.get('k') ?? '10,20,50')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  const options = readScoringOptions(flags);
  const exported = readExport(input);

  const games: NormalizedGameRecord[] = [];
  for (const row of exported.games) {
    const identity = readRowIdentity(row);
    const game = identity
      ? normalizeDbGameRow({
          igdb_game_id: identity.igdbGameId,
          platform_igdb_id: identity.platformIgdbId,
          payload: row.payload,
        })
      : null;
    if (game) {
      games.push(game);
    }
  }

  const embeddingsByGame = new Map<string, number[]>();
  for (const row of exported.embeddings) {
    const identity = readRowIdentity(row);
    const raw = row.embedding;
    if (!identity || (typeof raw !== 'string' && !Array.isArray(raw))) {
      continue;
    }
    const vector = parseEmbeddingVector(raw as string | number[]);
    if (vector.length > 0) {
      embeddingsByGame.set(buildGameKey(identity.igdbGameId, identity.platformIgdbId), vector);
    }
  }

  const keywordArtifacts = buildKeywordArtifacts(games, RECOMMENDATION_KEYWORD_SELECTION_DEFAULTS);
  const startedAt = Date.now();
  const result = evaluateRecommendationQuality({
    games,
    embeddingsByGame,
    structuredKeywordsByGame: keywordArtifacts.structuredKeywordsByGame,
    options,
    runtimeMode,
    ks,
  });
  const elapsedMs = Date.now() - startedAt;

  if (flags.has('json')) {
    process.stdout.write(`${JSON.stringify({ options, result }, null, 2)}\n`);
    return;
  }

  const lines = [
    `Games loaded: ${String(games.length)} (embeddings: ${String(embeddingsByGame.size)})`,
    `Rated library games: ${String(result.ratedCount)} → liked ${String(result.likedCount)}, disliked ${String(result.dislikedCount)}`,
    `Backlog pool per held-out game: ${String(result.candidatePoolSize)} (+1)`,
    `Runtime mode: ${result.runtimeMode}`,
    '',
    ...result.hitRate.map((entry) => `hit@${String(entry.k)}: ${formatPercent(entry.rate)}`),
    `MRR: ${result.meanReciprocalRank.toFixed(4)}`,
    `Liked percentile (0 = top): mean ${result.meanLikedPercentile.toFixed(3)}, median ${result.medianLikedPercentile.toFixed(3)}`,
    `AUC liked vs disliked: ${result.auc === null ? 'n/a' : result.auc.toFixed(4)}`,
    '',
    `Tuned weights (full data): ${JSON.stringify(result.fullDataTunedWeights)}`,
    `Evaluated in ${String(elapsedMs)}ms`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function readRowIdentity(row: ExportRow): { igdbGameId: string; platformIgdbId: number } | null {
  const igdbGameId =
    typeof row.igdb_game_id === 'string' || typeof row.igdb_game_id === 'number'
      ? String(row.igdb_game_id).trim()
      : '';
  const platformIgdbId = Number(row.platform_igdb_id);

  if (!igdbGameId || !Number.isInteger(platformIgdbId) || platformIgdbId <= 0) {
    return null;
  }

  return { igdbGameId, platformIgdbId };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

main();
