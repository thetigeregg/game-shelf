import { isDeepStrictEqual } from 'node:util';
import { MetadataEnrichmentIgdbClient } from './igdb-client.js';
import { MetadataEnrichmentRepository } from './repository.js';
import {
  IgdbMetadataRecord,
  MetadataEnrichmentGameRow,
  MetadataEnrichmentSummary,
} from './types.js';

export interface MetadataEnrichmentServiceOptions {
  enabled: boolean;
  batchSize: number;
  maxGamesPerRun: number;
  startupDelayMs: number;
}

type EnrichmentStatus = 'success' | 'no_data';

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
            message: error instanceof Error ? error.message : String(error),
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
        failedBatches: 0,
      };

      if (rows.length === 0) {
        return summary;
      }

      const rowsNeedingMetadata = rows.filter((row) => rowNeedsMetadataFetch(row.payload));
      const uniqueGameIds = [...new Set(rowsNeedingMetadata.map((row) => row.igdbGameId))];
      summary.uniqueGamesRequested = uniqueGameIds.length;
      const metadataByGameId = new Map<string, IgdbMetadataRecord>();
      const successfullyFetchedGameIds = new Set<string>();
      const completedAt = new Date(this.now()).toISOString();

      for (const batch of sliceIntoBatches(uniqueGameIds, this.options.batchSize)) {
        try {
          const fetched = await this.igdbClient.fetchGameMetadataByIds(batch);
          for (const gameId of batch) {
            successfullyFetchedGameIds.add(gameId);
          }
          fetched.forEach((value, key) => {
            metadataByGameId.set(key, value);
          });
        } catch (error) {
          summary.failedBatches += 1;
          console.warn('[metadata_enrichment] igdb_batch_failed', {
            batchSize: batch.length,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      for (const row of rows) {
        const needsMetadata = rowNeedsMetadataFetch(row.payload);
        const payloadPatch = buildMetadataPatch({
          row,
          metadata: metadataByGameId.get(row.igdbGameId),
          metadataFetched: needsMetadata && successfullyFetchedGameIds.has(row.igdbGameId),
          needsSyncBackfill:
            !needsMetadata && isBlank(payloadValueAsString(row.payload['metadataSyncEnqueuedAt'])),
          completedAt,
        });
        const changed = Object.keys(payloadPatch).length > 0;

        if (!changed) {
          summary.skippedRows += 1;
          continue;
        }

        await this.repository.updateGamePayload({
          client,
          igdbGameId: row.igdbGameId,
          platformIgdbId: row.platformIgdbId,
          payloadPatch,
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
      completedAt: new Date(this.now()).toISOString(),
    });
    return lockResult.value;
  }
}

function buildMetadataPatch(params: {
  row: MetadataEnrichmentGameRow;
  metadata: IgdbMetadataRecord | undefined;
  metadataFetched: boolean;
  needsSyncBackfill: boolean;
  completedAt: string;
}): Record<string, unknown> {
  if (!params.metadataFetched && !params.needsSyncBackfill) {
    return {};
  }

  const nextValues: Record<string, unknown> = {};
  if (!params.metadataFetched) {
    nextValues['metadataSyncEnqueuedAt'] = params.completedAt;
    return pickChangedTopLevelFields(params.row.payload, nextValues);
  }

  const status: EnrichmentStatus = params.metadata ? 'success' : 'no_data';
  if (params.metadata) {
    nextValues['themes'] = params.metadata.themes;
    nextValues['themeIds'] = params.metadata.themeIds;
    nextValues['keywords'] = params.metadata.keywords;
    nextValues['keywordIds'] = params.metadata.keywordIds;
    nextValues['screenshots'] = params.metadata.screenshots;
    nextValues['videos'] = params.metadata.videos;
    nextValues['websites'] = params.metadata.websites;
    nextValues['steamAppId'] = params.metadata.steamAppId;
  }
  nextValues['taxonomyEnrichmentStatus'] = status;
  nextValues['taxonomyEnrichedAt'] = params.completedAt;
  nextValues['mediaEnrichmentStatus'] = status;
  nextValues['mediaEnrichedAt'] = params.completedAt;
  nextValues['steamEnrichmentStatus'] = status;
  nextValues['steamEnrichedAt'] = params.completedAt;
  nextValues['metadataSyncEnqueuedAt'] = params.completedAt;
  return pickChangedTopLevelFields(params.row.payload, nextValues);
}

function pickChangedTopLevelFields(
  current: Record<string, unknown>,
  nextValues: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, nextValue] of Object.entries(nextValues)) {
    if (!isDeepStrictEqual(current[key], nextValue)) {
      patch[key] = nextValue;
    }
  }
  return patch;
}

function rowNeedsMetadataFetch(payload: Record<string, unknown>): boolean {
  return (
    isBlank(payloadValueAsString(payload['taxonomyEnrichedAt'])) ||
    isBlank(payloadValueAsString(payload['mediaEnrichedAt'])) ||
    isBlank(payloadValueAsString(payload['steamEnrichedAt'])) ||
    !Object.prototype.hasOwnProperty.call(payload, 'websites')
  );
}

function payloadValueAsString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function sliceIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const normalizedBatchSize = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 1;
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += normalizedBatchSize) {
    batches.push(items.slice(index, index + normalizedBatchSize));
  }

  return batches;
}
