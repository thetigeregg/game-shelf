import type { PoolClient } from 'pg';
import { RecommendationRepository } from './repository.js';
import { GameEmbeddingUpsertInput, StoredGameEmbedding } from './types.js';

export class EmbeddingRepository {
  constructor(private readonly repository: RecommendationRepository) {}

  listGameEmbeddings(client?: PoolClient): Promise<StoredGameEmbedding[]> {
    return this.repository.listGameEmbeddings(client);
  }

  upsertGameEmbeddings(params: {
    client: PoolClient;
    rows: GameEmbeddingUpsertInput[];
  }): Promise<void> {
    return this.repository.upsertGameEmbeddings(params);
  }
}
