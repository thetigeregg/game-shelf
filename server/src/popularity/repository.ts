import type { Pool, PoolClient } from 'pg';

export class PopularityRepository {
  constructor(private readonly pool: Pool) {}

  async withAdvisoryLock<T>(params: {
    namespace: number;
    key: number;
    callback: (client: PoolClient) => Promise<T>;
  }): Promise<{ acquired: true; value: T } | { acquired: false }> {
    const client = await this.pool.connect();
    let acquired = false;

    try {
      const lockResult = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS acquired',
        [params.namespace, params.key]
      );

      acquired = lockResult.rows[0]?.acquired ?? false;
      if (!acquired) {
        return { acquired: false };
      }

      const value = await params.callback(client);
      return { acquired: true, value };
    } finally {
      if (acquired) {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [params.namespace, params.key]);
      }
      client.release();
    }
  }
}
