import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { getCacheMetrics } from './cache-metrics.js';
import rateLimit from '@fastify/rate-limit';

interface CacheCountRow {
  count: string;
}

interface CacheCountSnapshot {
  imageAssetCount: number | null;
  hltbEntryCount: number | null;
  dbError: string | null;
}

export async function registerCacheObservabilityRoutes(
  app: FastifyInstance,
  pool: Pool
): Promise<void> {
  await app.register(rateLimit, {
    max: 60, // maximum number of requests per IP per time window
    timeWindow: '1 minute'
  });

  let snapshot: CacheCountSnapshot = {
    imageAssetCount: null,
    hltbEntryCount: null,
    dbError: null
  };

  const refreshSnapshot = async (): Promise<void> => {
    try {
      const imageCountResult = await pool.query<CacheCountRow>(
        'SELECT COUNT(*)::text AS count FROM image_assets'
      );
      const hltbCountResult = await pool.query<CacheCountRow>(
        'SELECT COUNT(*)::text AS count FROM hltb_search_cache'
      );

      snapshot = {
        imageAssetCount: Number.parseInt(imageCountResult.rows[0]?.count ?? '0', 10),
        hltbEntryCount: Number.parseInt(hltbCountResult.rows[0]?.count ?? '0', 10),
        dbError: null
      };
    } catch (error) {
      snapshot = {
        imageAssetCount: null,
        hltbEntryCount: null,
        dbError: error instanceof Error ? error.message : String(error)
      };
    }
  };

  await refreshSnapshot();

  const refreshHandle = setInterval(() => {
    void refreshSnapshot();
  }, 30_000);
  refreshHandle.unref();

  app.addHook('onClose', async () => {
    clearInterval(refreshHandle);
  });

  app.get(
    '/v1/cache/stats',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute'
        }
      }
    },
    async (_request, reply) => {
      const metrics = getCacheMetrics();

      reply.send({
        timestamp: new Date().toISOString(),
        metrics,
        counts: {
          imageAssets: snapshot.imageAssetCount,
          hltbEntries: snapshot.hltbEntryCount
        },
        dbError: snapshot.dbError
      });
    }
  );
}
