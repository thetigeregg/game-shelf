export function isValidYouTubeVideoId(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value.trim());
}
