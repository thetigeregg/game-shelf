import type { FastifyRequest } from 'fastify';

const MAX_BODY_PREVIEW_CHARS = 4000;
const REDACTED = '***';

function readEnv(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function isDebugHttpLogsEnabled(): boolean {
  const raw = readEnv('DEBUG_HTTP_LOGS').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function sanitizeUrlForDebugLogs(urlInput: string): string {
  try {
    const parsed = new URL(urlInput);
    const sensitiveKeys = ['api_key', 'apikey', 'client_secret', 'token', 'access_token'];

    for (const key of sensitiveKeys) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    }

    return parsed.toString();
  } catch {
    return urlInput;
  }
}

function sanitizeHeaderValue(name: string, value: string): string {
  const normalizedName = name.trim().toLowerCase();
  if (
    normalizedName === 'authorization' ||
    normalizedName === 'x-api-key' ||
    normalizedName === 'api-key'
  ) {
    return REDACTED;
  }
  return value;
}

export function sanitizeHeadersForDebugLogs(
  headers: HeadersInit | undefined
): Record<string, string> {
  if (!headers) {
    return {};
  }

  const sanitized: Record<string, string> = {};
  const source = new Headers(headers);
  source.forEach((value, key) => {
    sanitized[key] = sanitizeHeaderValue(key, value);
  });
  return sanitized;
}

async function readResponsePreview(response: Response): Promise<string | null> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('application/json') && !contentType.startsWith('text/')) {
    return null;
  }

  try {
    const text = await response.clone().text();
    if (!text) {
      return null;
    }
    return text.length <= MAX_BODY_PREVIEW_CHARS
      ? text
      : `${text.slice(0, MAX_BODY_PREVIEW_CHARS)}...[truncated]`;
  } catch {
    return null;
  }
}

export function logUpstreamRequest(
  request: FastifyRequest,
  options: {
    url: string;
    method: string;
    headers?: HeadersInit;
  }
): void {
  if (!isDebugHttpLogsEnabled()) {
    return;
  }

  request.log.info({
    msg: 'upstream_http_request',
    method: options.method,
    url: sanitizeUrlForDebugLogs(options.url),
    headers: sanitizeHeadersForDebugLogs(options.headers)
  });
}

export async function logUpstreamResponse(
  request: FastifyRequest,
  options: {
    url: string;
    method: string;
    response: Response;
  }
): Promise<void> {
  if (!isDebugHttpLogsEnabled()) {
    return;
  }

  request.log.info({
    msg: 'upstream_http_response',
    method: options.method,
    url: sanitizeUrlForDebugLogs(options.url),
    status: options.response.status,
    bodyPreview: await readResponsePreview(options.response)
  });
}
