import { describe, expect, it } from 'vitest';
import type { ReviewMatchCandidate } from '../core/models/game.models';
import type { AdminDiscoveryListItem } from '../core/services/admin-discovery-match.service';
import {
  buildAdminQueueFeedback,
  describeAdminTargetedRows,
  groupAdminDiscoveryItems,
  resolveAdminPricingSource,
  dedupeReviewAdminCandidates,
} from './admin-discovery-match.utils';

function createItem(overrides: Partial<AdminDiscoveryListItem> = {}): AdminDiscoveryListItem {
  return {
    igdbGameId: '123',
    platformIgdbId: 48,
    title: 'Chrono Trigger',
    platform: 'PlayStation',
    releaseYear: 1999,
    matchState: {
      hltb: {
        status: 'missing',
        locked: false,
        attempts: 0,
        lastTriedAt: null,
        nextTryAt: null,
        permanentMiss: false,
      },
      review: {
        status: 'missing',
        locked: false,
        attempts: 0,
        lastTriedAt: null,
        nextTryAt: null,
        permanentMiss: false,
      },
      pricing: {
        status: 'missing',
        locked: false,
        attempts: 0,
        lastTriedAt: null,
        nextTryAt: null,
        permanentMiss: false,
      },
    },
    ...overrides,
  };
}

describe('adminDiscoveryMatchUtils', () => {
  it('groups multiple discovery rows for the same game and keeps combined state', () => {
    const grouped = groupAdminDiscoveryItems([
      createItem(),
      createItem({
        platformIgdbId: 167,
        platform: 'PlayStation 5',
        matchState: {
          ...createItem().matchState,
          review: {
            status: 'permanentMiss',
            locked: true,
            attempts: 4,
            lastTriedAt: '2026-03-12T00:00:00.000Z',
            nextTryAt: null,
            permanentMiss: true,
          },
        },
      }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.platform).toBe('Multiple platforms');
    expect(grouped[0]?.gameKeys).toEqual(['123::48', '123::167']);
    expect(grouped[0]?.matchState.review.status).toBe('permanentMiss');
    expect(grouped[0]?.matchState.review.attempts).toBe(4);
  });

  it('deduplicates review candidates while preferring entries with richer metadata', () => {
    const bare: ReviewMatchCandidate = {
      title: 'Chrono Trigger',
      releaseYear: 1999,
      platform: 'PlayStation',
      reviewScore: 91,
      reviewUrl: '',
      reviewSource: 'metacritic',
      isRecommended: true,
    };
    const richer: ReviewMatchCandidate = {
      ...bare,
      reviewUrl: 'https://example.com/review',
      imageUrl: 'https://example.com/image.jpg',
    };

    const deduped = dedupeReviewAdminCandidates([bare, richer]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.reviewUrl).toBe('https://example.com/review');
    expect(deduped[0]?.imageUrl).toBe('https://example.com/image.jpg');
  });

  it('formats queue feedback and targeted-row summaries with provider-aware copy', () => {
    const feedback = buildAdminQueueFeedback(
      { queued: false, deduped: true, queuedCount: 0, dedupedCount: 1 },
      'pricing',
      'list'
    );
    const summary = describeAdminTargetedRows([
      createItem(),
      createItem({
        igdbGameId: '200',
        platformIgdbId: 6,
        title: 'Half-Life',
        platform: 'PC',
        releaseYear: 1998,
      }),
      createItem({
        igdbGameId: '300',
        platformIgdbId: 167,
        title: 'Astro Bot',
        platform: 'PlayStation 5',
        releaseYear: 2024,
      }),
      createItem({
        igdbGameId: '400',
        platformIgdbId: 130,
        title: 'Nioh',
        platform: 'PlayStation 4',
        releaseYear: 2017,
      }),
    ]);

    expect(feedback).toEqual({
      message: 'Targeted pricing refresh is already queued.',
      tone: 'warning',
    });
    expect(summary).toBe(
      '4 games targeted: Chrono Trigger (PlayStation, 1999), Half-Life (PC, 1998), Astro Bot (PlayStation 5, 2024), +1 more'
    );
  });

  it('defaults pricing source by platform when no stored source exists', () => {
    expect(resolveAdminPricingSource(6, null)).toBe('steam_store');
    expect(resolveAdminPricingSource(48, null)).toBe('psprices');
    expect(resolveAdminPricingSource(48, 'steam_store')).toBe('steam_store');
  });
});
