import type { FastifyInstance } from 'fastify';
import type { RecommendationServiceApi } from './service.js';
import { parseRecommendationTarget, parseRuntimeModeOrNull } from './service.js';
import { applyRouteRateLimit } from '../rate-limit.js';
import type { RecommendationLaneKey } from './types.js';

const MAX_PAGE_OFFSET = 1000;

interface RebuildBody {
  target?: unknown;
  force?: unknown;
}

export function registerRecommendationRoutes(
  app: FastifyInstance,
  service: RecommendationServiceApi
): Promise<void> {
  app.route({
    method: 'GET',
    url: '/v1/recommendations/top',
    config: applyRouteRateLimit('recommendations_read'),
    handler: async (request, reply) => {
      const query = request.query as { target?: unknown; runtimeMode?: unknown; limit?: unknown };
      const target = parseRecommendationTarget(query.target);

      if (!target) {
        reply
          .code(400)
          .send({ error: 'Query parameter target must be BACKLOG, WISHLIST, or DISCOVERY.' });
        return;
      }

      const runtimeMode = parseRuntimeModeOrNull(query.runtimeMode);
      if (query.runtimeMode !== undefined && runtimeMode === null) {
        reply
          .code(400)
          .send({ error: 'Query parameter runtimeMode must be NEUTRAL, SHORT, or LONG.' });
        return;
      }

      const limit = parsePositiveInteger(query.limit) ?? 20;
      const queueState = await service.ensureRebuildQueuedIfStale(target, 'stale-read');
      const result = await service.getTopRecommendations(target, limit, runtimeMode);

      if (!result) {
        let responseJobId = queueState.jobId;
        let responseReason = queueState.reason;
        if (!queueState.queued) {
          const fallbackQueue = await service.enqueueRebuild({
            target,
            force: false,
            triggeredBy: 'stale-read',
          });
          responseJobId = fallbackQueue.jobId;
          responseReason = 'missing';
        }
        reply.code(202).send({
          target,
          status: 'QUEUED',
          jobId: responseJobId,
          reason: responseReason,
          error: 'No recommendations available yet. Rebuild has been queued.',
        });
        return;
      }

      reply.send({
        target,
        runtimeMode: result.runtimeMode,
        runId: result.run.id,
        generatedAt: result.run.finishedAt ?? result.run.startedAt,
        staleRefreshQueued: queueState.queued,
        staleRefreshReason: queueState.reason === 'fresh' ? null : queueState.reason,
        staleRefreshJobId: queueState.jobId,
        items: result.items,
      });
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/recommendations/lanes',
    config: applyRouteRateLimit('recommendations_read'),
    handler: async (request, reply) => {
      const query = request.query as {
        target?: unknown;
        runtimeMode?: unknown;
        lane?: unknown;
        offset?: unknown;
        limit?: unknown;
      };
      const target = parseRecommendationTarget(query.target);

      if (!target) {
        reply
          .code(400)
          .send({ error: 'Query parameter target must be BACKLOG, WISHLIST, or DISCOVERY.' });
        return;
      }

      const runtimeMode = parseRuntimeModeOrNull(query.runtimeMode);
      if (query.runtimeMode !== undefined && runtimeMode === null) {
        reply
          .code(400)
          .send({ error: 'Query parameter runtimeMode must be NEUTRAL, SHORT, or LONG.' });
        return;
      }

      const offset = Math.min(parseNonNegativeInteger(query.offset) ?? 0, MAX_PAGE_OFFSET);
      const limit = parsePositiveInteger(query.limit);
      const lane = query.lane === undefined ? null : parseRecommendationLaneKey(query.lane);

      if (query.lane !== undefined && !lane) {
        reply.code(400).send({
          error:
            'Query parameter lane must be one of overall, hiddenGems, exploration, blended, popular, or recent.',
        });
        return;
      }

      const queueState = await service.ensureRebuildQueuedIfStale(target, 'stale-read');

      if (query.lane === undefined) {
        const result = await service.getRecommendationLaneCollection(
          target,
          limit ?? 20,
          runtimeMode
        );

        if (!result) {
          let responseJobId = queueState.jobId;
          let responseReason = queueState.reason;
          if (!queueState.queued) {
            const fallbackQueue = await service.enqueueRebuild({
              target,
              force: false,
              triggeredBy: 'stale-read',
            });
            responseJobId = fallbackQueue.jobId;
            responseReason = 'missing';
          }
          reply.code(202).send({
            target,
            status: 'QUEUED',
            jobId: responseJobId,
            reason: responseReason,
            error: 'No recommendations available yet. Rebuild has been queued.',
          });
          return;
        }

        reply.send({
          target,
          runtimeMode: result.runtimeMode,
          runId: result.run.id,
          generatedAt: result.run.finishedAt ?? result.run.startedAt,
          staleRefreshQueued: queueState.queued,
          staleRefreshReason: queueState.reason === 'fresh' ? null : queueState.reason,
          staleRefreshJobId: queueState.jobId,
          lanes: result.lanes,
        });
        return;
      }

      const result = await service.getRecommendationLanes(
        target,
        lane,
        offset,
        limit ?? 10,
        runtimeMode
      );

      if (!result) {
        let responseJobId = queueState.jobId;
        let responseReason = queueState.reason;
        if (!queueState.queued) {
          const fallbackQueue = await service.enqueueRebuild({
            target,
            force: false,
            triggeredBy: 'stale-read',
          });
          responseJobId = fallbackQueue.jobId;
          responseReason = 'missing';
        }
        reply.code(202).send({
          target,
          status: 'QUEUED',
          jobId: responseJobId,
          reason: responseReason,
          error: 'No recommendations available yet. Rebuild has been queued.',
        });
        return;
      }

      reply.send({
        target,
        runtimeMode: result.runtimeMode,
        runId: result.run.id,
        generatedAt: result.run.finishedAt ?? result.run.startedAt,
        staleRefreshQueued: queueState.queued,
        staleRefreshReason: queueState.reason === 'fresh' ? null : queueState.reason,
        staleRefreshJobId: queueState.jobId,
        lane: result.lane,
        items: result.items,
        page: result.page,
      });
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/recommendations/rebuild',
    config: applyRouteRateLimit('recommendations_rebuild'),
    handler: async (request, reply) => {
      const body = (request.body ?? {}) as RebuildBody;
      const target = parseRecommendationTarget(body.target);

      if (!target) {
        reply.code(400).send({ error: 'Body target must be BACKLOG, WISHLIST, or DISCOVERY.' });
        return;
      }

      const force = body.force === true;
      const result = await service.enqueueRebuild({ target, force, triggeredBy: 'manual' });
      reply.code(202).send({
        target,
        status: 'QUEUED',
        jobId: result.jobId,
        deduped: result.deduped,
      });
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/recommendations/similar/:igdbGameId',
    config: applyRouteRateLimit('recommendations_read'),
    handler: async (request, reply) => {
      const params = request.params as { igdbGameId?: unknown };
      const query = request.query as {
        target?: unknown;
        runtimeMode?: unknown;
        platformIgdbId?: unknown;
        offset?: unknown;
        limit?: unknown;
      };
      const igdbGameId = typeof params.igdbGameId === 'string' ? params.igdbGameId.trim() : '';

      if (!/^\d+$/.test(igdbGameId)) {
        reply.code(400).send({ error: 'Path parameter igdbGameId must be numeric.' });
        return;
      }

      const platformIgdbId = parsePositiveInteger(query.platformIgdbId);

      if (!platformIgdbId) {
        reply
          .code(400)
          .send({ error: 'Query parameter platformIgdbId must be a positive integer.' });
        return;
      }

      const target = parseRecommendationTarget(query.target);
      if (!target) {
        reply
          .code(400)
          .send({ error: 'Query parameter target must be BACKLOG, WISHLIST, or DISCOVERY.' });
        return;
      }
      const runtimeMode = parseRuntimeModeOrNull(query.runtimeMode);
      if (query.runtimeMode !== undefined && runtimeMode === null) {
        reply
          .code(400)
          .send({ error: 'Query parameter runtimeMode must be NEUTRAL, SHORT, or LONG.' });
        return;
      }

      const offset = parseNonNegativeInteger(query.offset) ?? 0;
      const limit = parsePositiveInteger(query.limit) ?? 20;
      await service.ensureRebuildQueuedIfStale(target, 'stale-read');
      const result = await service.getSimilarGames({
        igdbGameId,
        platformIgdbId,
        target,
        runtimeMode,
        offset,
        limit,
      });

      reply.send({
        source: {
          igdbGameId,
          platformIgdbId,
        },
        runtimeMode: result.runtimeMode,
        items: result.items,
        page: result.page,
      });
    },
  });

  return Promise.resolve();
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = parseNonNegativeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) {
      return null;
    }

    try {
      const parsed = BigInt(normalized);
      if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
        return null;
      }
      return Number(parsed);
    } catch {
      return null;
    }
  }

  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    return Number(value);
  }

  return null;
}

function parseRecommendationLaneKey(value: unknown): RecommendationLaneKey | null {
  return value === 'overall' ||
    value === 'hiddenGems' ||
    value === 'exploration' ||
    value === 'blended' ||
    value === 'popular' ||
    value === 'recent'
    ? value
    : null;
}
