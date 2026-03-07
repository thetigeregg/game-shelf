import type { FastifyInstance } from 'fastify';
import type { RecommendationServiceApi } from './service.js';
import { parseRecommendationTarget, parseRuntimeModeOrNull } from './service.js';

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
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute'
      }
    },
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
            triggeredBy: 'stale-read'
          });
          responseJobId = fallbackQueue.jobId;
          responseReason = 'missing';
        }
        reply.code(202).send({
          target,
          status: 'QUEUED',
          jobId: responseJobId,
          reason: responseReason,
          error: 'No recommendations available yet. Rebuild has been queued.'
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
        items: result.items
      });
    }
  });

  app.route({
    method: 'GET',
    url: '/v1/recommendations/lanes',
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute'
      }
    },
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
      const result = await service.getRecommendationLanes(target, limit, runtimeMode);

      if (!result) {
        let responseJobId = queueState.jobId;
        let responseReason = queueState.reason;
        if (!queueState.queued) {
          const fallbackQueue = await service.enqueueRebuild({
            target,
            force: false,
            triggeredBy: 'stale-read'
          });
          responseJobId = fallbackQueue.jobId;
          responseReason = 'missing';
        }
        reply.code(202).send({
          target,
          status: 'QUEUED',
          jobId: responseJobId,
          reason: responseReason,
          error: 'No recommendations available yet. Rebuild has been queued.'
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
        lanes: result.lanes
      });
    }
  });

  app.route({
    method: 'POST',
    url: '/v1/recommendations/rebuild',
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    },
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
        deduped: result.deduped
      });
    }
  });

  app.route({
    method: 'GET',
    url: '/v1/recommendations/similar/:igdbGameId',
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute'
      }
    },
    handler: async (request, reply) => {
      const params = request.params as { igdbGameId?: unknown };
      const query = request.query as {
        target?: unknown;
        runtimeMode?: unknown;
        platformIgdbId?: unknown;
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

      const limit = parsePositiveInteger(query.limit) ?? 20;
      await service.ensureRebuildQueuedIfStale(target, 'stale-read');
      const result = await service.getSimilarGames({
        igdbGameId,
        platformIgdbId,
        target,
        runtimeMode,
        limit
      });

      reply.send({
        source: {
          igdbGameId,
          platformIgdbId
        },
        runtimeMode: result.runtimeMode,
        items: result.items
      });
    }
  });

  return Promise.resolve();
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) {
      return null;
    }
    const parsed = Number.parseInt(normalized, 10);
    return parsed > 0 ? parsed : null;
  }

  return null;
}
