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
      await service.rebuildIfStale(target, 'stale-read');
      const result = await service.getTopRecommendations(target, limit, runtimeMode);

      if (!result) {
        reply.code(404).send({
          error: 'No recommendations available. Trigger a rebuild first.'
        });
        return;
      }

      reply.send({
        target,
        runtimeMode: result.runtimeMode,
        runId: result.run.id,
        generatedAt: result.run.finishedAt ?? result.run.startedAt,
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
      await service.rebuildIfStale(target, 'stale-read');
      const result = await service.getRecommendationLanes(target, limit, runtimeMode);

      if (!result) {
        reply.code(404).send({
          error: 'No recommendations available. Trigger a rebuild first.'
        });
        return;
      }

      reply.send({
        target,
        runtimeMode: result.runtimeMode,
        runId: result.run.id,
        generatedAt: result.run.finishedAt ?? result.run.startedAt,
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
      const result = await service.rebuild({ target, force, triggeredBy: 'manual' });

      if (result.status === 'LOCKED') {
        reply.code(409).send({ error: 'Rebuild already running for target.', target });
        return;
      }

      if (result.status === 'BACKOFF_SKIPPED') {
        reply.code(429).send({
          target,
          status: result.status,
          error: 'Automatic rebuild is in failure backoff cooldown.'
        });
        return;
      }

      if (result.status === 'FAILED') {
        reply.code(500).send({
          target,
          runId: result.runId,
          status: result.status
        });
        return;
      }

      reply.send({
        target,
        runId: result.runId,
        status: result.status,
        reusedRunId: result.status === 'SKIPPED' ? (result.reusedRunId ?? null) : null
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
      await service.rebuildIfStale(target, 'stale-read');
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

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return parsed > 0 ? parsed : null;
  }

  return null;
}
