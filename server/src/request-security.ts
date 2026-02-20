const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CLIENT_WRITE_TOKEN_HEADER_NAME = 'x-game-shelf-client-token';

interface MutatingRequestAuthOptions {
  requireAuth: boolean;
  apiToken: string;
  clientWriteTokens: string[];
  authorizationHeader: string | string[] | undefined;
  clientWriteTokenHeader: string | string[] | undefined;
}

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

export function isAuthorizedMutatingRequest(options: MutatingRequestAuthOptions): boolean {
  if (!options.requireAuth) {
    return true;
  }

  if (isAuthorizedBearerToken(options.authorizationHeader, options.apiToken)) {
    return true;
  }

  return isAuthorizedClientWriteToken(options.clientWriteTokenHeader, options.clientWriteTokens);
}

function isAuthorizedBearerToken(
  authorizationHeader: string | string[] | undefined,
  apiToken: string
): boolean {
  const configuredToken = String(apiToken ?? '').trim();

  if (configuredToken.length === 0) {
    return false;
  }

  const authorization = normalizeHeaderValue(authorizationHeader);

  if (!authorization.startsWith('Bearer ')) {
    return false;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 && token === configuredToken;
}

function isAuthorizedClientWriteToken(
  clientWriteTokenHeader: string | string[] | undefined,
  clientWriteTokens: string[]
): boolean {
  const token = normalizeHeaderValue(clientWriteTokenHeader);

  if (token.length === 0) {
    return false;
  }

  return clientWriteTokens.includes(token);
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? '').trim();
}
