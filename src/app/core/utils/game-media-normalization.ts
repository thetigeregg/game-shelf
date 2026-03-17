import { GameScreenshot, GameVideo } from '../models/game.models';

const DEFAULT_MAX_SCREENSHOTS = 20;
const DEFAULT_MAX_VIDEOS = 5;

export function normalizeGameScreenshots(
  values: unknown,
  options?: { maxItems?: number }
): GameScreenshot[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const maxItems =
    Number.isInteger(options?.maxItems) && (options?.maxItems as number) > 0
      ? (options?.maxItems as number)
      : DEFAULT_MAX_SCREENSHOTS;
  const seen = new Set<string>();
  const normalized: GameScreenshot[] = [];

  for (const value of values) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    const imageIdRaw =
      (value as { imageId?: unknown; image_id?: unknown }).imageId ??
      (value as { imageId?: unknown; image_id?: unknown }).image_id;
    const imageId = typeof imageIdRaw === 'string' ? imageIdRaw.trim() : '';
    if (imageId.length === 0) {
      continue;
    }

    const id = parsePositiveInteger((value as { id?: unknown }).id);
    const dedupeKey = id !== null ? `id:${String(id)}` : `image:${imageId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({
      id,
      imageId,
      url: `https://images.igdb.com/igdb/image/upload/t_screenshot_huge/${imageId}.jpg`,
      width: parsePositiveInteger((value as { width?: unknown }).width),
      height: parsePositiveInteger((value as { height?: unknown }).height),
    });

    if (normalized.length >= maxItems) {
      break;
    }
  }

  return normalized;
}

export function normalizeGameVideos(values: unknown, options?: { maxItems?: number }): GameVideo[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const maxItems =
    Number.isInteger(options?.maxItems) && (options?.maxItems as number) > 0
      ? (options?.maxItems as number)
      : DEFAULT_MAX_VIDEOS;
  const seen = new Set<string>();
  const normalized: GameVideo[] = [];

  for (const value of values) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    const videoIdRaw =
      (value as { videoId?: unknown; video_id?: unknown }).videoId ??
      (value as { videoId?: unknown; video_id?: unknown }).video_id;
    const videoId = typeof videoIdRaw === 'string' ? videoIdRaw.trim() : '';
    if (videoId.length === 0) {
      continue;
    }

    const id = parsePositiveInteger((value as { id?: unknown }).id);
    const dedupeKey = id !== null ? `id:${String(id)}` : `video:${videoId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    const name = (value as { name?: unknown }).name;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    normalized.push({
      id,
      name: normalizedName.length > 0 ? normalizedName : null,
      videoId,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    });

    if (normalized.length >= maxItems) {
      break;
    }
  }

  return normalized;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
