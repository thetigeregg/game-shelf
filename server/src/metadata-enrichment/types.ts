export interface MetadataEnrichmentGameRow {
  igdbGameId: string;
  platformIgdbId: number;
  payload: Record<string, unknown>;
}

export interface IgdbGameScreenshot {
  id: number | null;
  imageId: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface IgdbGameVideo {
  id: number | null;
  name: string | null;
  videoId: string;
  url: string;
}

export interface IgdbMetadataRecord {
  themes: string[];
  themeIds: number[];
  keywords: string[];
  keywordIds: number[];
  screenshots: IgdbGameScreenshot[];
  videos: IgdbGameVideo[];
}

export interface MetadataEnrichmentSummary {
  scannedRows: number;
  uniqueGamesRequested: number;
  updatedRows: number;
  skippedRows: number;
  failedBatches: number;
}
