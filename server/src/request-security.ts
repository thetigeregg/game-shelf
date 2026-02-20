const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function shouldRequireAuth(method: string): boolean {
  const normalized = String(method ?? '')
    .trim()
    .toUpperCase();

  if (!normalized) {
    return true;
  }

  return !SAFE_HTTP_METHODS.has(normalized);
}
