import { describe, expect, it } from 'vitest';
import { GameEntry } from '../models/game.models';
import {
  calculatePriceAdjustedTimeAdjustedScore,
  calculateTimeAdjustedScore,
  normalizeCriticScore,
  resolveEffectiveHltbHours,
  resolveEffectivePriceForGame,
  resolveNormalizedCriticScoreForGame,
  resolvePriceAdjustedTimeAdjustedScoreForGame,
  resolveTimeAdjustedScoreForGame,
} from './time-adjusted-score.util';

function makeGame(partial: Partial<GameEntry>): GameEntry {
  return {
    igdbGameId: partial.igdbGameId ?? '1',
    platformIgdbId: partial.platformIgdbId ?? 130,
    title: partial.title ?? 'Game',
    coverUrl: partial.coverUrl ?? null,
    coverSource: partial.coverSource ?? 'none',
    platform: partial.platform ?? 'Nintendo Switch',
    releaseDate: partial.releaseDate ?? null,
    releaseYear: partial.releaseYear ?? null,
    listType: partial.listType ?? 'collection',
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-01-01T00:00:00.000Z',
    hltbMainHours: partial.hltbMainHours ?? null,
    hltbMainExtraHours: partial.hltbMainExtraHours ?? null,
    hltbCompletionistHours: partial.hltbCompletionistHours ?? null,
    reviewScore: partial.reviewScore ?? null,
    reviewSource: partial.reviewSource ?? null,
    metacriticScore: partial.metacriticScore ?? null,
    mobyScore: partial.mobyScore ?? null,
    priceAmount: partial.priceAmount ?? null,
    priceIsFree: partial.priceIsFree ?? null,
  };
}

describe('time-adjusted-score.util', () => {
  it('normalizes critic scores from source scales', () => {
    expect(normalizeCriticScore(93, 'metacritic')).toBe(93);
    expect(normalizeCriticScore(9.3, 'mobygames')).toBe(93);
  });

  it('calculates TAS with clamping and finite guards', () => {
    expect(calculateTimeAdjustedScore(90, 10, 20)).toBe(76.73);
    expect(calculateTimeAdjustedScore(120, 0, 20)).toBe(100);
    expect(calculateTimeAdjustedScore(90, 10, 0)).toBe(20.18);
    expect(calculateTimeAdjustedScore(Number.NaN, 10, 20)).toBeNull();
  });

  it('calculates PTAS with price penalty and finite guards', () => {
    expect(calculatePriceAdjustedTimeAdjustedScore(90, 10, 20, 20, 10)).toBe(53.31);
    expect(calculatePriceAdjustedTimeAdjustedScore(90, 10, 20, 0, 10)).toBe(76.73);
    expect(calculatePriceAdjustedTimeAdjustedScore(90, 10, 20, Number.NaN, 10)).toBeNull();
  });

  it('resolves effective HLTB hours using main -> main+extra -> completionist fallback', () => {
    expect(resolveEffectiveHltbHours(makeGame({ hltbMainHours: 8 }))).toBe(8);
    expect(
      resolveEffectiveHltbHours(makeGame({ hltbMainHours: null, hltbMainExtraHours: 11.2 }))
    ).toBe(11.2);
    expect(
      resolveEffectiveHltbHours(
        makeGame({
          hltbMainHours: null,
          hltbMainExtraHours: null,
          hltbCompletionistHours: 15,
        })
      )
    ).toBe(15);
    expect(
      resolveEffectiveHltbHours(
        makeGame({
          hltbMainHours: null,
          hltbMainExtraHours: null,
          hltbCompletionistHours: null,
        })
      )
    ).toBeNull();
  });

  it('treats zero-hour HLTB values as missing', () => {
    expect(
      resolveEffectiveHltbHours(
        makeGame({
          hltbMainHours: 0,
          hltbMainExtraHours: 0,
          hltbCompletionistHours: 6,
        })
      )
    ).toBe(6);

    expect(
      resolveEffectiveHltbHours(
        makeGame({
          hltbMainHours: 0,
          hltbMainExtraHours: 0,
          hltbCompletionistHours: 0,
        })
      )
    ).toBeNull();
  });

  it('normalizes MobyGames critic score only when raw score is on 0-10 scale', () => {
    expect(
      resolveNormalizedCriticScoreForGame(
        makeGame({ reviewScore: 8.8, reviewSource: 'mobygames', mobyScore: 8.8 })
      )
    ).toBe(88);
    expect(
      resolveNormalizedCriticScoreForGame(
        makeGame({ reviewScore: 10, reviewSource: 'mobygames', mobyScore: 1.0 })
      )
    ).toBe(10);
  });

  it('resolves effective price from current price and free flag', () => {
    expect(resolveEffectivePriceForGame(makeGame({ priceAmount: 19.99 }))).toBe(19.99);
    expect(resolveEffectivePriceForGame(makeGame({ priceAmount: null, priceIsFree: true }))).toBe(
      0
    );
    expect(
      resolveEffectivePriceForGame(makeGame({ priceAmount: null, priceIsFree: false }))
    ).toBeNull();
  });

  it('returns null TAS when score or fallback hours are missing', () => {
    expect(
      resolveTimeAdjustedScoreForGame(
        makeGame({
          reviewScore: null,
          metacriticScore: null,
          hltbMainHours: 8,
        }),
        20
      )
    ).toBeNull();
    expect(
      resolveTimeAdjustedScoreForGame(
        makeGame({
          reviewScore: 85,
          reviewSource: 'metacritic',
          hltbMainHours: null,
          hltbMainExtraHours: null,
          hltbCompletionistHours: null,
        }),
        20
      )
    ).toBeNull();
  });

  it('returns null PTAS when score, hours, or price are missing', () => {
    expect(
      resolvePriceAdjustedTimeAdjustedScoreForGame(
        makeGame({
          reviewScore: 85,
          reviewSource: 'metacritic',
          hltbMainHours: 8,
          priceAmount: null,
        }),
        20,
        10
      )
    ).toBeNull();

    expect(
      resolvePriceAdjustedTimeAdjustedScoreForGame(
        makeGame({
          reviewScore: 85,
          reviewSource: 'metacritic',
          hltbMainHours: 8,
          priceAmount: 20,
        }),
        20,
        10
      )
    ).toBe(50.98);
  });
});
