import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { BackgroundJobRepository, BackgroundJobType } from './background-jobs.js';
import { config } from './config.js';
import { applyRouteRateLimit } from './rate-limit.js';
import { isAuthorizedMutatingRequest } from './request-security.js';

interface FailedJobsQuery {
  jobType?: unknown;
  failedBefore?: unknown;
  limit?: unknown;
}

interface ReplayFailedJobsBody {
  jobType?: unknown;
  failedBefore?: unknown;
  limit?: unknown;
}

export function registerBackgroundJobRoutes(app: FastifyInstance, pool: Pool): void {
  const repository = new BackgroundJobRepository(pool);

  app.get(
    '/v1/background-jobs/stats',
    {
      config: applyRouteRateLimit('background_jobs_stats'),
    },
    async (_request, reply) => {
      const stats = await repository.getTypeStats();
      const totals = stats.reduce(
        (accumulator, item) => ({
          pending: accumulator.pending + item.pending,
          running: accumulator.running + item.running,
          failed: accumulator.failed + item.failed,
          succeeded: accumulator.succeeded + item.succeeded,
        }),
        {
          pending: 0,
          running: 0,
          failed: 0,
          succeeded: 0,
        }
      );
      const oldestPendingSeconds =
        stats
          .map((item) => item.oldestPendingSeconds)
          .filter((value): value is number => value !== null)
          .sort((left, right) => right - left)[0] ?? null;

      reply.send({
        timestamp: new Date().toISOString(),
        totals,
        oldestPendingSeconds,
        byType: stats,
      });
    }
  );

  app.get(
    '/v1/background-jobs/failed',
    {
      config: applyRouteRateLimit('background_jobs_failed_list'),
    },
    async (request, reply) => {
      if (!isBackgroundJobAdminAuthorized(request, reply)) {
        return;
      }

      const query = (request.query ?? {}) as FailedJobsQuery;
      const jobType = parseJobType(query.jobType);
      const failedBefore = parseIsoDateOrNull(query.failedBefore);
      const limit = parseLimit(query.limit, 100);
      const failed = await repository.listFailed({
        jobType,
        failedBeforeIso: failedBefore,
        limit,
      });

      reply.send({
        count: failed.length,
        items: failed,
      });
    }
  );

  app.post(
    '/v1/background-jobs/replay',
    {
      config: applyRouteRateLimit('background_jobs_replay'),
    },
    async (request, reply) => {
      if (!isBackgroundJobAdminAuthorized(request, reply)) {
        return;
      }

      const body = (request.body ?? {}) as ReplayFailedJobsBody;
      const jobType = parseJobType(body.jobType);
      const failedBefore = parseIsoDateOrNull(body.failedBefore);
      const limit = parseLimit(body.limit, 100);
      const result = await repository.requeueFailed({
        jobType,
        failedBeforeIso: failedBefore,
        limit,
      });

      reply.send({
        ok: true,
        ...result,
      });
    }
  );
}

function parseJobType(value: unknown): BackgroundJobType | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  const knownTypes: BackgroundJobType[] = [
    'recommendations_rebuild',
    'metadata_enrichment_run',
    'igdb_popularity_ingest',
    'release_monitor_game',
    'discovery_enrichment_run',
    'hltb_cache_revalidate',
    'metacritic_cache_revalidate',
    'mobygames_cache_revalidate',
    'steam_price_revalidate',
    'psprices_price_revalidate',
    'manuals_catalog_refresh',
  ];
  return knownTypes.includes(normalized as BackgroundJobType)
    ? (normalized as BackgroundJobType)
    : null;
}

function parseIsoDateOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  return Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function parseLimit(value: unknown, fallback: number): number {
  const asString =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'bigint'
        ? String(value)
        : '';
  const parsed = Number.parseInt(asString, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(500, parsed);
}

function isBackgroundJobAdminAuthorized(
  request: FastifyRequest,
  reply: { code: (statusCode: number) => { send: (payload: unknown) => void } }
): boolean {
  const authorized = isAuthorizedMutatingRequest({
    requireAuth: config.requireAuth,
    apiToken: config.apiToken,
    clientWriteTokens: [],
    authorizationHeader: request.headers.authorization,
    clientWriteTokenHeader: undefined,
  });

  if (!authorized) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }

  return true;
}
