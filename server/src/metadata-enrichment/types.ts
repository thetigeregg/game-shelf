export interface MetadataEnrichmentGameRow {
  igdbGameId: string;
  platformIgdbId: number;
  payload: Record<string, unknown>;
}

export interface IgdbMetadataRecord {
  themes: string[];
  themeIds: number[];
  keywords: string[];
  keywordIds: number[];
}

export interface MetadataEnrichmentSummary {
  scannedRows: number;
  uniqueGamesRequested: number;
  updatedRows: number;
  skippedRows: number;
  failedBatches: number;
}
