const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Determine whether the given HTTP method must be authenticated.
 *
 * This method-based approach treats only the standard "safe" methods
 * (GET, HEAD, OPTIONS) as read-only and exempt from authentication.
 * All other methods (POST, PUT, PATCH, DELETE, etc.) are treated as
 * potentially mutating and therefore always require auth, regardless
 * of the URL path or query string.
 *
 * Relying on HTTP methods rather than specific paths avoids subtle
 * bypasses where path-based checks can be circumvented via alternate
 * routes or crafted query parameters. Keeping this logic strictly
 * method-driven helps ensure all state-changing operations remain
 * protected even as routes evolve over time.
 */
export function shouldRequireAuth(method: string): boolean {
  const normalized = String(method ?? '')
    .trim()
    .toUpperCase();

  if (!normalized) {
    return true;
  }

  return !SAFE_HTTP_METHODS.has(normalized);
}
