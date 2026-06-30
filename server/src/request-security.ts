import { timingSafeEqual } from 'node:crypto';

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CLIENT_WRITE_TOKEN_HEADER_NAME = 'x-game-shelf-client-token';
// Carries the shared internal token on the release monitor's in-cluster
// self-calls so the inbound rate limiter can exempt them (see
// ensureRateLimitRegistered allowList / isReleaseMonitorInternalRequest). The
// token is resolved by resolveReleaseMonitorInternalToken from a dedicated
// internal secret (falling back to the API token) — both server-only. It is
// deliberately NOT a client write token: those are distributed to client apps,
// so honoring one here would let any client that extracts its token bypass
// inbound rate limits on every route. A static marker would be equally
// spoofable.
export const RELEASE_MONITOR_INTERNAL_HEADER_NAME = 'x-gameshelf-release-monitor';

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
  const normalized = method.trim().toUpperCase();

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

/**
 * Resolve the shared secret the release monitor presents on its in-cluster
 * self-calls (and that the inbound rate limiter verifies for exemption).
 * Prefers a dedicated internal token; falls back to the API token. Both are
 * server-only secrets, so the exemption can never be triggered by a credential
 * distributed to client apps (a client write token). Returns '' when neither is
 * configured, so the path fails closed: self-calls are simply rate-limited like
 * any other client rather than silently exempted by a guessable marker.
 */
export function resolveReleaseMonitorInternalToken(
  internalToken: string,
  apiToken: string
): string {
  const trimmedInternalToken = internalToken.trim();

  if (trimmedInternalToken.length > 0) {
    return trimmedInternalToken;
  }

  return apiToken.trim();
}

/**
 * Authorize the release monitor's in-cluster self-calls for inbound rate-limit
 * exemption. The request must present the configured internal token (resolved by
 * resolveReleaseMonitorInternalToken) in the internal header (timing-safe match).
 * An unset token never exempts, so the path fails closed and a static/spoofed
 * marker cannot bypass inbound limits.
 */
export function isReleaseMonitorInternalRequest(
  headerValue: string | string[] | undefined,
  internalToken: string
): boolean {
  const configuredToken = internalToken.trim();

  if (configuredToken.length === 0) {
    return false;
  }

  const provided = normalizeHeaderValue(headerValue);

  if (provided.length === 0) {
    return false;
  }

  return timingSafeStringEqual(provided, configuredToken);
}

function isAuthorizedBearerToken(
  authorizationHeader: string | string[] | undefined,
  apiToken: string
): boolean {
  const configuredToken = apiToken.trim();

  if (configuredToken.length === 0) {
    return false;
  }

  const authorization = normalizeHeaderValue(authorizationHeader);

  if (!authorization.startsWith('Bearer ')) {
    return false;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 && timingSafeStringEqual(token, configuredToken);
}

function isAuthorizedClientWriteToken(
  clientWriteTokenHeader: string | string[] | undefined,
  clientWriteTokens: string[]
): boolean {
  const token = normalizeHeaderValue(clientWriteTokenHeader);

  if (token.length === 0) {
    return false;
  }

  return clientWriteTokens.some((configuredToken) => timingSafeStringEqual(token, configuredToken));
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').trim();
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.concat([bufA, Buffer.alloc(maxLen - bufA.length)]);
  const paddedB = Buffer.concat([bufB, Buffer.alloc(maxLen - bufB.length)]);
  const bytesEqual = timingSafeEqual(paddedA, paddedB);
  const lengthsEqual = bufA.length === bufB.length;
  return bytesEqual && lengthsEqual;
}
