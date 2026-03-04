import { MetadataEnrichmentIgdbClient } from './igdb-client.js';
import { MetadataEnrichmentRepository } from './repository.js';
import {
  IgdbMetadataRecord,
  MetadataEnrichmentGameRow,
  MetadataEnrichmentSummary
} from './types.js';

export interface MetadataEnrichmentServiceOptions {
  enabled: boolean;
  batchSize: number;
  maxGamesPerRun: number;
  startupDelayMs: number;
}

export class MetadataEnrichmentService {
  constructor(
    private readonly repository: MetadataEnrichmentRepository,
    private readonly igdbClient: MetadataEnrichmentIgdbClient,
    private readonly options: MetadataEnrichmentServiceOptions,
    private readonly now: () => number = () => Date.now()
  ) {}

  start(): void {
    if (!this.options.enabled) {
      return;
    }

    setTimeout(
      () => {
        void this.runOnce().catch((error: unknown) => {
          console.warn('[metadata_enrichment] startup_run_failed', {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      },
      Math.max(0, this.options.startupDelayMs)
    );
  }

  async runOnce(): Promise<MetadataEnrichmentSummary | null> {
    const lockResult = await this.repository.withAdvisoryLock(async (client) => {
      const rows = await this.repository.listRowsMissingMetadata(
        this.options.maxGamesPerRun,
        client
      );
      const summary: MetadataEnrichmentSummary = {
        scannedRows: rows.length,
        uniqueGamesRequested: 0,
        updatedRows: 0,
        skippedRows: 0,
        failedBatches: 0
      };

      if (rows.length === 0) {
        return summary;
      }

      const uniqueGameIds = [...new Set(rows.map((row) => row.igdbGameId))];
      summary.uniqueGamesRequested = uniqueGameIds.length;
      const metadataByGameId = new Map<string, IgdbMetadataRecord>();

      for (const batch of sliceIntoBatches(uniqueGameIds, this.options.batchSize)) {
        try {
          const fetched = await this.igdbClient.fetchGameMetadataByIds(batch);
          fetched.forEach((value, key) => {
            metadataByGameId.set(key, value);
          });
        } catch (error) {
          summary.failedBatches += 1;
          console.warn('[metadata_enrichment] igdb_batch_failed', {
            batchSize: batch.length,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }

      for (const row of rows) {
        const mergedPayload = mergeMetadataIntoPayload(row, metadataByGameId.get(row.igdbGameId));
        const changed = JSON.stringify(mergedPayload) !== JSON.stringify(row.payload);

        if (!changed) {
          summary.skippedRows += 1;
          continue;
        }

        await this.repository.updateGamePayload({
          client,
          igdbGameId: row.igdbGameId,
          platformIgdbId: row.platformIgdbId,
          payload: mergedPayload
        });
        summary.updatedRows += 1;
      }

      return summary;
    });

    if (!lockResult.acquired) {
      console.info('[metadata_enrichment] skipped (lock not acquired)');
      return null;
    }

    console.info('[metadata_enrichment] completed', {
      ...lockResult.value,
      completedAt: new Date(this.now()).toISOString()
    });
    return lockResult.value;
  }
}

function mergeMetadataIntoPayload(
  row: MetadataEnrichmentGameRow,
  metadata: IgdbMetadataRecord | undefined
): Record<string, unknown> {
  if (!metadata) {
    return row.payload;
  }

  return {
    ...row.payload,
    themes: metadata.themes,
    themeIds: metadata.themeIds,
    keywords: metadata.keywords,
    keywordIds: metadata.keywordIds,
    screenshots: metadata.screenshots,
    videos: metadata.videos
  };
}

function sliceIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const normalizedBatchSize = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 1;
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += normalizedBatchSize) {
    batches.push(items.slice(index, index + normalizedBatchSize));
  }

  return batches;
}
