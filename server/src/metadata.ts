import type { FastifyReply, FastifyRequest } from 'fastify';
import { handleRequest as handleWorkerRequest } from '../../worker/src/index.mjs';
import { config } from './config.js';

interface WorkerEnvLike {
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  THEGAMESDB_API_KEY: string;
  HLTB_SCRAPER_BASE_URL?: string;
  HLTB_SCRAPER_TOKEN?: string;
  DEBUG_HTTP_LOGS?: string;
  DEBUG_HLTB_LOGS?: string;
}

const workerEnv: WorkerEnvLike = {
  TWITCH_CLIENT_ID: config.twitchClientId,
  TWITCH_CLIENT_SECRET: config.twitchClientSecret,
  THEGAMESDB_API_KEY: config.theGamesDbApiKey,
  HLTB_SCRAPER_BASE_URL: config.hltbScraperBaseUrl,
  HLTB_SCRAPER_TOKEN: config.hltbScraperToken,
  DEBUG_HTTP_LOGS: process.env.DEBUG_HTTP_LOGS ?? '',
  DEBUG_HLTB_LOGS: process.env.DEBUG_HLTB_LOGS ?? '',
};

export async function proxyMetadataToWorker(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const requestUrl = new URL(request.url, 'http://game-shelf.local');
  const proxiedRequest = new Request(requestUrl.toString(), {
    method: request.method,
    headers: request.headers as HeadersInit,
  });

  const response = await handleWorkerRequest(proxiedRequest, workerEnv, fetch, () => Date.now());
  await sendWebResponse(reply, response);
}

async function sendWebResponse(reply: FastifyReply, response: Response): Promise<void> {
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

