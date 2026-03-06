const DEFAULT_SCREENSHOT_LIMIT = 20;
const DEFAULT_VIDEO_LIMIT = 5;

function parsePositiveInteger(value) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeIgdbScreenshotList(value, options = {}) {
  if (!Array.isArray(value)) {
    return [];
  }

  const limit =
    Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_SCREENSHOT_LIMIT;
  const sizeRaw = typeof options.size === 'string' ? options.size.trim() : '';
  const size = sizeRaw.length > 0 ? sizeRaw : 't_screenshot_huge';
  const seen = new Set();
  const normalized = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const imageIdRaw = entry.image_id ?? entry.imageId;
    const imageId = typeof imageIdRaw === 'string' ? imageIdRaw.trim() : '';
    if (!imageId) {
      continue;
    }

    const id = parsePositiveInteger(entry.id);
    const dedupeKey = id !== null ? `id:${String(id)}` : `image:${imageId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({
      id,
      imageId,
      url: `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`,
      width: parsePositiveInteger(entry.width),
      height: parsePositiveInteger(entry.height)
    });

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}

export function normalizeIgdbVideoList(value, options = {}) {
  if (!Array.isArray(value)) {
    return [];
  }

  const limit =
    Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_VIDEO_LIMIT;
  const seen = new Set();
  const normalized = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const videoIdRaw = entry.video_id ?? entry.videoId;
    const videoId = typeof videoIdRaw === 'string' ? videoIdRaw.trim() : '';
    if (!videoId) {
      continue;
    }

    const id = parsePositiveInteger(entry.id);
    const dedupeKey = id !== null ? `id:${String(id)}` : `video:${videoId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    normalized.push({
      id,
      name: name.length > 0 ? name : null,
      videoId,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    });

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}
