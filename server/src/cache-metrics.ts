export interface CacheMetricSnapshot {
  mobygames: {
    hits: number;
    misses: number;
    bypasses: number;
    writes: number;
    readErrors: number;
    writeErrors: number;
    staleServed: number;
    revalidateScheduled: number;
    revalidateSkipped: number;
    revalidateSucceeded: number;
    revalidateFailed: number;
  };
  metacritic: {
    hits: number;
    misses: number;
    bypasses: number;
    writes: number;
    readErrors: number;
    writeErrors: number;
    staleServed: number;
    revalidateScheduled: number;
    revalidateSkipped: number;
    revalidateSucceeded: number;
    revalidateFailed: number;
  };
  hltb: {
    hits: number;
    misses: number;
    bypasses: number;
    writes: number;
    readErrors: number;
    writeErrors: number;
    staleServed: number;
    revalidateScheduled: number;
    revalidateSkipped: number;
    revalidateSucceeded: number;
    revalidateFailed: number;
  };
  image: {
    hits: number;
    misses: number;
    writes: number;
    readErrors: number;
    writeErrors: number;
    upstreamErrors: number;
    invalidRequests: number;
  };
  steamPrice: {
    hits: number;
    misses: number;
    writes: number;
    readErrors: number;
    writeErrors: number;
    upstreamErrors: number;
    invalidRequests: number;
  };
  pspricesPrice: {
    hits: number;
    misses: number;
    writes: number;
    readErrors: number;
    writeErrors: number;
    upstreamErrors: number;
    invalidRequests: number;
  };
}

const metrics: CacheMetricSnapshot = {
  mobygames: {
    hits: 0,
    misses: 0,
    bypasses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
    staleServed: 0,
    revalidateScheduled: 0,
    revalidateSkipped: 0,
    revalidateSucceeded: 0,
    revalidateFailed: 0
  },
  metacritic: {
    hits: 0,
    misses: 0,
    bypasses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
    staleServed: 0,
    revalidateScheduled: 0,
    revalidateSkipped: 0,
    revalidateSucceeded: 0,
    revalidateFailed: 0
  },
  hltb: {
    hits: 0,
    misses: 0,
    bypasses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
    staleServed: 0,
    revalidateScheduled: 0,
    revalidateSkipped: 0,
    revalidateSucceeded: 0,
    revalidateFailed: 0
  },
  image: {
    hits: 0,
    misses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
    upstreamErrors: 0,
    invalidRequests: 0
  },
  steamPrice: {
    hits: 0,
    misses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
    upstreamErrors: 0,
    invalidRequests: 0
  },
  pspricesPrice: {
    hits: 0,
    misses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
    upstreamErrors: 0,
    invalidRequests: 0
  }
};

export function incrementHltbMetric(metric: keyof CacheMetricSnapshot['hltb']): void {
  metrics.hltb[metric] += 1;
}

export function incrementMobygamesMetric(metric: keyof CacheMetricSnapshot['mobygames']): void {
  metrics.mobygames[metric] += 1;
}

export function incrementMetacriticMetric(metric: keyof CacheMetricSnapshot['metacritic']): void {
  metrics.metacritic[metric] += 1;
}

export function incrementImageMetric(metric: keyof CacheMetricSnapshot['image']): void {
  metrics.image[metric] += 1;
}

export function incrementSteamPriceMetric(metric: keyof CacheMetricSnapshot['steamPrice']): void {
  metrics.steamPrice[metric] += 1;
}

export function incrementPspricesPriceMetric(
  metric: keyof CacheMetricSnapshot['pspricesPrice']
): void {
  metrics.pspricesPrice[metric] += 1;
}

export function getCacheMetrics(): CacheMetricSnapshot {
  return {
    mobygames: { ...metrics.mobygames },
    metacritic: { ...metrics.metacritic },
    hltb: { ...metrics.hltb },
    image: { ...metrics.image },
    steamPrice: { ...metrics.steamPrice },
    pspricesPrice: { ...metrics.pspricesPrice }
  };
}

export function resetCacheMetrics(): void {
  metrics.mobygames = {
    hits: 0,
    misses: 0,
    bypasses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
    staleServed: 0,
    revalidateScheduled: 0,
    revalidateSkipped: 0,
    revalidateSucceeded: 0,
    revalidateFailed: 0
  };
  metrics.metacritic = {
    hits: 0,
    misses: 0,
    bypasses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
    staleServed: 0,
    revalidateScheduled: 0,
    revalidateSkipped: 0,
    revalidateSucceeded: 0,
    revalidateFailed: 0
  };
  metrics.hltb = {
    hits: 0,
    misses: 0,
    bypasses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
    staleServed: 0,
    revalidateScheduled: 0,
    revalidateSkipped: 0,
    revalidateSucceeded: 0,
    revalidateFailed: 0
  };
  metrics.image = {
    hits: 0,
    misses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
    upstreamErrors: 0,
    invalidRequests: 0
  };
  metrics.steamPrice = {
    hits: 0,
    misses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
    upstreamErrors: 0,
    invalidRequests: 0
  };
  metrics.pspricesPrice = {
    hits: 0,
    misses: 0,
    writes: 0,
    readErrors: 0,
    writeErrors: 0,
    upstreamErrors: 0,
    invalidRequests: 0
  };
}
