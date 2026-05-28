import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameEntry, Tag } from '../../core/models/game.models';
import type { ShareFileParams } from '../../core/utils/share-file.util';
import { exportSelectedGamesCsv } from './game-list-selection-export.util';

function createGame(): GameEntry {
  const now = '2024-01-01T00:00:00.000Z';
  return {
    igdbGameId: '1234',
    platformIgdbId: 19,
    title: 'Chrono Trigger',
    coverUrl: null,
    coverSource: 'igdb',
    platform: 'Super Nintendo Entertainment System',
    releaseDate: '1995-03-11',
    releaseYear: 1995,
    listType: 'collection',
    createdAt: now,
    updatedAt: now,
  };
}

describe('exportSelectedGamesCsv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when no games are selected', async () => {
    const listTags = vi.fn();
    const shareFile = vi.fn().mockResolvedValue(undefined);

    await exportSelectedGamesCsv([], { listTags, shareFile });

    expect(listTags).not.toHaveBeenCalled();
    expect(shareFile).not.toHaveBeenCalled();
  });

  it('builds CSV from selected games and shares the export file', async () => {
    const tags: Tag[] = [
      {
        id: 1,
        name: 'Favorites',
        color: '#3880ff',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const listTags = vi.fn<() => Promise<Tag[]>>().mockResolvedValue(tags);
    const shareFile = vi
      .fn<(params: ShareFileParams) => Promise<void>>()
      .mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T12:00:00.000Z'));

    await exportSelectedGamesCsv([createGame()], { listTags, shareFile });

    expect(listTags).toHaveBeenCalledOnce();
    expect(shareFile).toHaveBeenCalledOnce();
    expect(shareFile.mock.calls[0]?.[0]).toMatchObject({
      filename: 'game-shelf-selected-export-2026-05-28T12-00-00-000Z.csv',
      mimeType: 'text/csv;charset=utf-8',
    });
    expect(shareFile.mock.calls[0]?.[0]?.content).toContain('Chrono Trigger');

    vi.useRealTimers();
  });
});
