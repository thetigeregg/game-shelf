import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import type { SharedProviderRateLimitPolicy } from './provider-rate-limit.js';
import { RELEASE_MONITOR_INTERNAL_HEADER_NAME } from './request-security.js';

export interface InboundRateLimitConfig {
  max: number;
  windowMs: number;
}

export interface OutboundRateLimitConfig extends SharedProviderRateLimitPolicy {
  requestTimeoutMs?: number;
}

export type RateLimitPolicyName =
  | 'public_read'
  | 'search_read'
  | 'metadata_game_by_id'
  | 'image_proxy'
  | 'image_purge'
  | 'cache_stats'
  | 'sync_push'
  | 'sync_pull'
  | 'recommendations_read'
  | 'recommendations_rebuild'
  | 'notifications_register'
  | 'notifications_unregister'
  | 'notifications_test'
  | 'notifications_observability'
  | 'admin_read'
  | 'admin_detail'
  | 'admin_mutation'
  | 'background_jobs_stats'
  | 'background_jobs_failed_list'
  | 'background_jobs_replay'
  | 'manuals_read'
  | 'manuals_refresh'
  | 'roms_read'
  | 'roms_refresh'
  | 'popularity_feed'
  | 'steam_prices'
  | 'psprices_prices'
  | 'hltb_search'
  | 'metacritic_search'
  | 'mobygames_search';

export type ProviderRateLimitPolicyName =
  | 'igdb_metadata_proxy'
  | 'igdb_discovery'
  | 'igdb_metadata_enrichment'
  | 'igdb_popularity'
  | 'mobygames';

export function resolveInboundRateLimit(policyName: RateLimitPolicyName): InboundRateLimitConfig {
  return config.rateLimit.inbound[policyName];
}

export function resolveOutboundRateLimit(
  policyName: ProviderRateLimitPolicyName
): OutboundRateLimitConfig {
  return config.rateLimit.outbound[policyName];
}

export function applyRouteRateLimit(policyName: RateLimitPolicyName): {
  rateLimit: { max: number; timeWindow: string };
} {
  const resolved = resolveInboundRateLimit(policyName);
  return {
    rateLimit: {
      max: resolved.max,
      timeWindow: formatTimeWindow(resolved.windowMs),
    },
  };
}

export async function ensureRateLimitRegistered(app: FastifyInstance): Promise<void> {
  if (!app.hasDecorator('rateLimit')) {
    await app.register(rateLimit, {
      global: false,
      // Exempt the release monitor's in-cluster self-calls from inbound limits:
      // routing its HLTB/Metacritic/MobyGames refresh through the API would
      // otherwise starve against tight buckets (e.g. mobygames_search at 12/min).
      // Upstream scrapers stay protected by the separate outbound limiters.
      allowList: (request: FastifyRequest) =>
        request.headers[RELEASE_MONITOR_INTERNAL_HEADER_NAME] === '1',
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
      },
    });
  }
}

export function formatTimeWindow(windowMs: number): string {
  return `${String(Math.max(1, Math.ceil(windowMs / 1000)))} seconds`;
}
