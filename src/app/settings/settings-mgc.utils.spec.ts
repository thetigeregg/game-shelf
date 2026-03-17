import { describe, expect, it } from 'vitest';

import type { MgcImportRow } from './settings-mgc.utils';
import {
  getGameKey,
  getMgcRowGameKey,
  hasHltbData,
  isMgcAutoSelectedMultiple,
  isMgcRowError,
  isMgcRowReady,
  isMgcRowSuccess,
  isMgcRowWarning,
  normalizeCompletionHours,
  normalizeLookupKey,
  normalizeMgcTitleForMatch,
  parseMgcLabels,
  recomputeMgcDuplicateErrors,
  resolveGlobalCooldownWaitMs,
  resolveRateLimitRetryDelayMs,
  resolveTransientRetryDelayMs
} from './settings-mgc.utils';

function row(overrides: Partial<MgcImportRow> = {}): MgcImportRow {
  return {
    id: 1,
    rowNumber: 1,
    name: 'Chrono Trigger',
    platformInput: 'SNES',
    platform: 'SNES',
    platformIgdbId: 19,
    labelsRaw: '',
    labels: [],
    status: 'pending',
    statusDetail: '',
    warning: null,
    error: null,
    duplicateError: null,
    candidates: [],
    selected: null,
    ...overrides
  };
}

describe('settings-mgc.utils', () => {
  it('evaluates row status helpers', () => {
    const multipleSelected = row({
      status: 'multiple',
      selected: { igdbGameId: '1', platformIgdbId: 19 } as never
    });
    expect(isMgcAutoSelectedMultiple(multipleSelected)).toBe(true);
    expect(isMgcRowReady(multipleSelected)).toBe(true);
    expect(isMgcRowWarning(row({ status: 'multiple', selected: null }))).toBe(true);
    expect(isMgcRowError(row({ status: 'noMatch' }))).toBe(true);
    expect(
      isMgcRowSuccess(
        row({ status: 'resolved', selected: { igdbGameId: '1', platformIgdbId: 19 } as never })
      )
    ).toBe(true);
  });

  it('parses and normalizes lookup strings', () => {
    expect(parseMgcLabels('')).toEqual([]);
    expect(parseMgcLabels(' jrpg, snes, jrpg , classic ')).toEqual(['jrpg', 'snes', 'classic']);
    expect(normalizeLookupKey('Chrono Trigger (SNES)!')).toBe('chronotriggersnes');
    expect(normalizeMgcTitleForMatch('  Chrono   Trigger  ')).toBe('chrono trigger');
  });

  it('resolves retry/cooldown timing values', () => {
    expect(resolveRateLimitRetryDelayMs('rate limited, retry after 2 s')).toBe(2000);
    expect(resolveRateLimitRetryDelayMs('rate limited, retry after 999 s')).toBe(60000);
    expect(resolveRateLimitRetryDelayMs('no retry-after')).toBe(1000);

    expect(resolveTransientRetryDelayMs(1)).toBe(1500);
    expect(resolveTransientRetryDelayMs(2)).toBe(3000);
    expect(resolveTransientRetryDelayMs(5)).toBe(12000);

    expect(resolveGlobalCooldownWaitMs(10000, 9000)).toBe(1000);
    expect(resolveGlobalCooldownWaitMs(10000, 12000)).toBe(0);
  });

  it('normalizes completion hours and checks presence', () => {
    expect(normalizeCompletionHours(undefined)).toBeNull();
    expect(normalizeCompletionHours(0)).toBeNull();
    expect(normalizeCompletionHours(12.34)).toBe(12.3);
    expect(
      hasHltbData({
        igdbGameId: '1',
        title: 'CT',
        coverUrl: null,
        coverSource: 'none',
        platform: 'SNES',
        platformIgdbId: 19,
        releaseDate: null,
        releaseYear: 1995,
        listType: 'collection',
        createdAt: 'x',
        updatedAt: 'x',
        hltbMainHours: 0,
        hltbMainExtraHours: 0,
        hltbCompletionistHours: 1
      })
    ).toBe(true);
  });

  it('builds row game keys only for valid resolved selections', () => {
    expect(getGameKey('123', 19)).toBe('123::19');
    expect(getMgcRowGameKey(row())).toBeNull();
    expect(
      getMgcRowGameKey(
        row({
          status: 'resolved',
          selected: { igdbGameId: '123', platformIgdbId: 19 } as never
        })
      )
    ).toBe('123::19');
    expect(
      getMgcRowGameKey(
        row({
          status: 'resolved',
          selected: { igdbGameId: 'abc', platformIgdbId: 19 } as never
        })
      )
    ).toBeNull();
  });

  it('recomputes duplicate errors for existing and in-import duplicates', () => {
    const rowA = row({
      id: 1,
      status: 'resolved',
      selected: { igdbGameId: '10', platformIgdbId: 19 } as never
    });
    const rowB = row({
      id: 2,
      rowNumber: 2,
      status: 'resolved',
      selected: { igdbGameId: '10', platformIgdbId: 19 } as never
    });
    const rowC = row({
      id: 3,
      rowNumber: 3,
      status: 'resolved',
      selected: { igdbGameId: '11', platformIgdbId: 19 } as never
    });

    recomputeMgcDuplicateErrors([rowA, rowB, rowC], new Set(['11::19']));

    expect(rowA.duplicateError).toBe('Duplicate game also appears in this MGC import.');
    expect(rowB.duplicateError).toBe('Duplicate game also appears in this MGC import.');
    expect(rowC.duplicateError).toBe('Duplicate game already exists in your library.');
  });
});
