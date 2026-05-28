import type { GameEntry, Tag } from '../../core/models/game.models';
import { presentShareFile, type ShareFileParams } from '../../core/utils/share-file.util';
import { buildGamesExportCsv } from '../../settings/settings-import-export.utils';

export interface ExportSelectedGamesCsvDeps {
  listTags: () => Promise<Tag[]>;
  shareFile?: (params: ShareFileParams) => Promise<void>;
}

export async function exportSelectedGamesCsv(
  selectedGames: GameEntry[],
  deps: ExportSelectedGamesCsvDeps
): Promise<void> {
  if (selectedGames.length === 0) {
    return;
  }

  const tags = await deps.listTags();
  const csv = buildGamesExportCsv(selectedGames, tags);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shareFile = deps.shareFile ?? presentShareFile;

  await shareFile({
    content: csv,
    filename: `game-shelf-selected-export-${timestamp}.csv`,
    mimeType: 'text/csv;charset=utf-8',
  });
}
