export interface NormalizedIgdbScreenshot {
  id: number | null;
  imageId: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface NormalizedIgdbVideo {
  id: number | null;
  name: string | null;
  videoId: string;
  url: string;
}

export function normalizeIgdbScreenshotList(
  value: unknown,
  options?: { limit?: number; size?: string }
): NormalizedIgdbScreenshot[];

export function normalizeIgdbVideoList(
  value: unknown,
  options?: { limit?: number }
): NormalizedIgdbVideo[];
