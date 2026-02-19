import type { FastifyReply, FastifyRequest } from 'fastify';
import { handleRequest as handleWorkerRequest } from '../../worker/src/index.mjs';
import { config } from './config.js';

interface WorkerEnvLike {
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  THEGAMESDB_API_KEY: string;
  DEBUG_HTTP_LOGS?: string;
}

const workerEnv: WorkerEnvLike = {
  TWITCH_CLIENT_ID: config.twitchClientId,
  TWITCH_CLIENT_SECRET: config.twitchClientSecret,
  THEGAMESDB_API_KEY: config.theGamesDbApiKey,
  DEBUG_HTTP_LOGS: process.env.DEBUG_HTTP_LOGS ?? ''
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
    headers: request.headers as HeadersInit
  });

  return handleWorkerRequest(
    proxiedRequest,
    workerEnv as unknown as Record<string, unknown>,
    fetch,
    () => Date.now()
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
