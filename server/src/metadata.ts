import type { FastifyReply, FastifyRequest } from 'fastify';
import { handleRequest as handleWorkerRequest } from '../../worker/src/index.mjs';
import { config } from './config.js';

interface WorkerEnvLike {
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  THEGAMESDB_API_KEY: string;
  DEBUG_HTTP_LOGS?: string;
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_REQUEST_TIMEOUT_MS: string;
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_MAX_REQUESTS: string;
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_WINDOW_MS: string;
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_REQUESTS_PER_SECOND: string;
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_MAX_CONCURRENT: string;
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_MIN_COOLDOWN_SECONDS: string;
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_DEFAULT_COOLDOWN_SECONDS: string;
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_MAX_COOLDOWN_SECONDS: string;
}

const workerEnv: WorkerEnvLike = {
  TWITCH_CLIENT_ID: config.twitchClientId,
  TWITCH_CLIENT_SECRET: config.twitchClientSecret,
  THEGAMESDB_API_KEY: config.theGamesDbApiKey,
  DEBUG_HTTP_LOGS: process.env.DEBUG_HTTP_LOGS ?? '',
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_REQUEST_TIMEOUT_MS: String(
    config.rateLimit.outbound.igdb_metadata_proxy.requestTimeoutMs ??
      config.igdbMetadataEnrichRequestTimeoutMs
  ),
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_MAX_REQUESTS: String(
    config.rateLimit.outbound.igdb_metadata_proxy.maxRequests ?? 60
  ),
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_WINDOW_MS: String(
    config.rateLimit.outbound.igdb_metadata_proxy.windowMs ?? 60_000
  ),
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_REQUESTS_PER_SECOND: String(
    config.rateLimit.outbound.igdb_metadata_proxy.requestsPerSecond ?? 4
  ),
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_MAX_CONCURRENT: String(
    config.rateLimit.outbound.igdb_metadata_proxy.maxConcurrent ?? 8
  ),
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_MIN_COOLDOWN_SECONDS: String(
    config.rateLimit.outbound.igdb_metadata_proxy.minCooldownSeconds ?? 20
  ),
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_DEFAULT_COOLDOWN_SECONDS: String(
    config.rateLimit.outbound.igdb_metadata_proxy.defaultCooldownSeconds ?? 15
  ),
  RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_MAX_COOLDOWN_SECONDS: String(
    config.rateLimit.outbound.igdb_metadata_proxy.maxCooldownSeconds ?? 60
  ),
};

export async function proxyMetadataToWorker(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const response = await fetchMetadataFromWorker(request);
  await sendWebResponse(reply, response);
}

export async function fetchMetadataFromWorker(request: FastifyRequest): Promise<Response> {
  const requestUrl = new URL(request.url, 'http://game-shelf.local');
  const proxiedRequest = new Request(requestUrl.toString(), {
    method: request.method,
    headers: request.headers as HeadersInit,
  });

  return handleWorkerRequest(
    proxiedRequest,
    workerEnv as unknown as Record<string, unknown>,
    fetch,
    { now: () => Date.now() }
  );
}

export async function fetchMetadataPathFromWorker(
  pathname: string,
  query?: Record<string, string | number | boolean | null | undefined>
): Promise<Response> {
  const requestUrl = new URL(pathname, 'http://game-shelf.local');

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        return;
      }

      requestUrl.searchParams.set(key, String(value));
    });
  }

  const proxiedRequest = new Request(requestUrl.toString(), {
    method: 'GET',
  });

  return handleWorkerRequest(
    proxiedRequest,
    workerEnv as unknown as Record<string, unknown>,
    fetch,
    { now: () => Date.now() }
  );
}

export async function sendWebResponse(reply: FastifyReply, response: Response): Promise<void> {
  reply.code(response.status);
  response.headers.forEach((value, key) => {
    reply.header(key, value);
  });

  if (!response.body) {
    reply.send();
    return;
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json') || contentType.startsWith('text/')) {
    const text = await response.text();
    reply.send(text);
    return;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  reply.send(bytes);
}
