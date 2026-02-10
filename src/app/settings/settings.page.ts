import { Component, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import {
  DEFAULT_GAME_LIST_FILTERS,
  GameCatalogResult,
  GameEntry,
  GameGroupByField,
  GameListFilters,
  GameListView,
  GameRating,
  GameStatus,
  ListType,
  Tag,
} from '../core/models/game.models';
import { ThemeService } from '../core/services/theme.service';
import { GAME_REPOSITORY, GameRepository } from '../core/data/game-repository';
import { GameShelfService } from '../core/services/game-shelf.service';

interface ThemePreset {
  label: string;
  value: string;
}

type ExportRowType = 'game' | 'tag' | 'view' | 'setting';

interface ExportCsvRow {
  type: ExportRowType;
  listType: string;
  igdbGameId: string;
  platformIgdbId: string;
  title: string;
  coverUrl: string;
  coverSource: string;
  platform: string;
  releaseDate: string;
  releaseYear: string;
  status: string;
  rating: string;
  developers: string;
  franchises: string;
  genres: string;
  publishers: string;
  tags: string;
  name: string;
  color: string;
  groupBy: string;
  filters: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

interface ParsedGameImportRow {
  kind: 'game';
  listType: ListType;
  catalog: GameCatalogResult;
  status: GameStatus | null;
  rating: GameRating | null;
  tagNames: string[];
}

interface ParsedTagImportRow {
  kind: 'tag';
  name: string;
  color: string;
}

interface ParsedViewImportRow {
  kind: 'view';
  name: string;
  listType: ListType;
  groupBy: GameGroupByField;
  filters: GameListFilters;
}

interface ParsedSettingImportRow {
  kind: 'setting';
  key: string;
  value: string;
}

type ParsedImportRow = ParsedGameImportRow | ParsedTagImportRow | ParsedViewImportRow | ParsedSettingImportRow;

interface ImportPreviewRow {
  id: number;
  rowNumber: number;
  type: ExportRowType | 'unknown';
  summary: string;
  error: string | null;
  warning: string | null;
  parsed: ParsedImportRow | null;
}

const CSV_HEADERS: Array<keyof ExportCsvRow> = [
  'type',
  'listType',
  'igdbGameId',
  'platformIgdbId',
  'title',
  'coverUrl',
  'coverSource',
  'platform',
  'releaseDate',
  'releaseYear',
  'status',
  'rating',
  'developers',
  'franchises',
  'genres',
  'publishers',
  'tags',
  'name',
  'color',
  'groupBy',
  'filters',
  'key',
  'value',
  'createdAt',
  'updatedAt',
];

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage {
  readonly presets: ThemePreset[] = [
    { label: 'Ionic Blue', value: '#3880ff' },
    { label: 'Emerald', value: '#2ecc71' },
    { label: 'Sunset Orange', value: '#ff6b35' },
    { label: 'Rose', value: '#e91e63' },
    { label: 'Slate', value: '#546e7a' },
  ];

  selectedColor = '';
  customColor = '';
  isImportPreviewOpen = false;
  isApplyingImport = false;
  importPreviewRows: ImportPreviewRow[] = [];

  private readonly themeService = inject(ThemeService);
  private readonly repository: GameRepository = inject(GAME_REPOSITORY);
  private readonly gameShelfService = inject(GameShelfService);
  private readonly toastController = inject(ToastController);
  private readonly alertController = inject(AlertController);

  constructor() {
    const currentColor = this.themeService.getPrimaryColor();
    this.selectedColor = this.findPresetColor(currentColor) ?? 'custom';
    this.customColor = currentColor;
  }

  get importErrorCount(): number {
    return this.importPreviewRows.filter(row => row.error !== null).length;
  }

  get importWarningCount(): number {
    return this.importPreviewRows.filter(row => row.warning !== null).length;
  }

  get canApplyImport(): boolean {
    return this.importPreviewRows.length > 0 && this.importErrorCount === 0 && !this.isApplyingImport;
  }

  onPresetColorChange(value: string): void {
    if (value === 'custom') {
      this.selectedColor = value;
      this.themeService.setPrimaryColor(this.customColor);
      return;
    }

    this.selectedColor = value;
    this.customColor = value;
    this.themeService.setPrimaryColor(value);
  }

  onCustomColorChange(value: string): void {
    if (!value) {
      return;
    }

    this.customColor = value;
    this.selectedColor = 'custom';
    this.themeService.setPrimaryColor(value);
  }

  async exportCsv(): Promise<void> {
    try {
      const csv = await this.buildExportCsv();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `game-shelf-export-${timestamp}.csv`;
      await this.presentShareDialog(csv, filename);
      await this.presentToast('CSV export prepared.');
    } catch {
      await this.presentToast('Unable to export CSV.', 'danger');
    }
  }

  triggerImport(fileInput: HTMLInputElement): void {
    fileInput.value = '';
    fileInput.click();
  }

  async onImportFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      this.importPreviewRows = await this.parseImportCsv(text);
      this.isImportPreviewOpen = true;
    } catch {
      this.importPreviewRows = [];
      this.isImportPreviewOpen = false;
      await this.presentToast('Unable to read CSV file.', 'danger');
    }
  }

  removeImportRow(rowId: number): void {
    this.importPreviewRows = this.importPreviewRows.filter(row => row.id !== rowId);
  }

  closeImportPreview(): void {
    this.isImportPreviewOpen = false;
  }

  async applyImport(): Promise<void> {
    if (!this.canApplyImport) {
      return;
    }

    this.isApplyingImport = true;

    try {
      const parsedRows = this.importPreviewRows
        .map(row => row.parsed)
        .filter((row): row is ParsedImportRow => row !== null);

      const settingRows = parsedRows.filter((row): row is ParsedSettingImportRow => row.kind === 'setting');
      const tagRows = parsedRows.filter((row): row is ParsedTagImportRow => row.kind === 'tag');
      const gameRows = parsedRows.filter((row): row is ParsedGameImportRow => row.kind === 'game');
      const viewRows = parsedRows.filter((row): row is ParsedViewImportRow => row.kind === 'view');

      let settingsApplied = 0;
      let tagsApplied = 0;
      let gamesApplied = 0;
      let gameStatusesApplied = 0;
      let gameRatingsApplied = 0;
      let gameTagAssignmentsApplied = 0;
      let viewsApplied = 0;
      let tagsRenamed = 0;
      let viewsRenamed = 0;
      let failedRows = 0;

      for (const settingRow of settingRows) {
        try {
          this.applyImportedSettings([settingRow]);
          settingsApplied += 1;
        } catch {
          failedRows += 1;
        }
      }

      const existingTags = await this.repository.listTags();
      const usedTagNames = new Set(
        existingTags
          .map(tag => tag.name.trim().toLowerCase())
          .filter(name => name.length > 0),
      );

      for (const tagRow of tagRows) {
        try {
          const resolvedName = this.resolveUniqueName(tagRow.name, usedTagNames);
          if (resolvedName !== tagRow.name) {
            tagsRenamed += 1;
          }
          await this.gameShelfService.createTag(resolvedName, tagRow.color);
          tagsApplied += 1;
        } catch {
          failedRows += 1;
        }
      }

      const tagMap = await this.buildTagNameToIdMap();

      for (const gameRow of gameRows) {
        const platformIgdbIdRaw = gameRow.catalog.platformIgdbId;

        if (typeof platformIgdbIdRaw !== 'number' || !Number.isInteger(platformIgdbIdRaw) || platformIgdbIdRaw <= 0) {
          failedRows += 1;
          continue;
        }
        const platformIgdbId = platformIgdbIdRaw;

        try {
          await this.gameShelfService.addGame(gameRow.catalog, gameRow.listType);
          gamesApplied += 1;

          if (gameRow.status !== null) {
            await this.gameShelfService.setGameStatus(gameRow.catalog.igdbGameId, platformIgdbId, gameRow.status);
            gameStatusesApplied += 1;
          }

          if (gameRow.rating !== null) {
            await this.gameShelfService.setGameRating(gameRow.catalog.igdbGameId, platformIgdbId, gameRow.rating);
            gameRatingsApplied += 1;
          }

          const tagIds = gameRow.tagNames
            .map(tagName => tagMap.get(tagName.toLowerCase()))
            .filter((tagId): tagId is number => typeof tagId === 'number' && Number.isInteger(tagId) && tagId > 0);

          if (tagIds.length > 0) {
            await this.gameShelfService.setGameTags(gameRow.catalog.igdbGameId, platformIgdbId, tagIds);
            gameTagAssignmentsApplied += 1;
          }
        } catch {
          failedRows += 1;
        }
      }

      const [collectionViews, wishlistViews] = await Promise.all([
        this.repository.listViews('collection'),
        this.repository.listViews('wishlist'),
      ]);
      const usedViewNames = new Set(
        [...collectionViews, ...wishlistViews]
          .map(view => view.name.trim().toLowerCase())
          .filter(name => name.length > 0),
      );

      for (const viewRow of viewRows) {
        try {
          const resolvedName = this.resolveUniqueName(viewRow.name, usedViewNames);
          if (resolvedName !== viewRow.name) {
            viewsRenamed += 1;
          }
          await this.gameShelfService.createView(resolvedName, viewRow.listType, viewRow.filters, viewRow.groupBy);
          viewsApplied += 1;
        } catch {
          failedRows += 1;
        }
      }

      const totalImported = settingsApplied + tagsApplied + gamesApplied + viewsApplied;
      const totalRows = parsedRows.length;
      const skippedRows = Math.max(totalRows - totalImported - failedRows, 0);

      this.importPreviewRows = [];
      this.isImportPreviewOpen = false;
      await this.presentToast('CSV import completed.');
      await this.presentImportSummary({
        totalRows,
        settingsApplied,
        tagsApplied,
        gamesApplied,
        gameStatusesApplied,
        gameRatingsApplied,
        gameTagAssignmentsApplied,
        viewsApplied,
        tagsRenamed,
        viewsRenamed,
        failedRows,
        skippedRows,
      });
    } catch {
      await this.presentToast('Unable to apply CSV import.', 'danger');
    } finally {
      this.isApplyingImport = false;
    }
  }

  private async presentImportSummary(summary: {
    totalRows: number;
    settingsApplied: number;
    tagsApplied: number;
    gamesApplied: number;
    gameStatusesApplied: number;
    gameRatingsApplied: number;
    gameTagAssignmentsApplied: number;
    viewsApplied: number;
    tagsRenamed: number;
    viewsRenamed: number;
    failedRows: number;
    skippedRows: number;
  }): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Import Summary',
      message: [
        `Total rows: ${summary.totalRows}`,
        `Games imported: ${summary.gamesApplied}`,
        `Tags imported: ${summary.tagsApplied}`,
        `Views imported: ${summary.viewsApplied}`,
        `Settings imported: ${summary.settingsApplied}`,
        `Game statuses set: ${summary.gameStatusesApplied}`,
        `Game ratings set: ${summary.gameRatingsApplied}`,
        `Game tag assignments: ${summary.gameTagAssignmentsApplied}`,
        `Tags auto-renamed: ${summary.tagsRenamed}`,
        `Views auto-renamed: ${summary.viewsRenamed}`,
        `Failed rows: ${summary.failedRows}`,
        `Skipped rows: ${summary.skippedRows}`,
      ].join('<br/>'),
      buttons: ['OK'],
    });

    await alert.present();
  }

  private async buildExportCsv(): Promise<string> {
    const [games, tags, collectionViews, wishlistViews] = await Promise.all([
      this.repository.listAll(),
      this.repository.listTags(),
      this.repository.listViews('collection'),
      this.repository.listViews('wishlist'),
    ]);

    const tagById = new Map<number, Tag>();

    tags.forEach(tag => {
      if (typeof tag.id === 'number' && tag.id > 0) {
        tagById.set(tag.id, tag);
      }
    });

    const rows: ExportCsvRow[] = [];

    games.forEach(game => {
      const tagNames = this.normalizeTagIds(game.tagIds)
        .map(tagId => tagById.get(tagId)?.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0);

      rows.push({
        type: 'game',
        listType: game.listType,
        igdbGameId: game.igdbGameId,
        platformIgdbId: String(game.platformIgdbId),
        title: game.title,
        coverUrl: game.coverUrl ?? '',
        coverSource: game.coverSource,
        platform: game.platform,
        releaseDate: game.releaseDate ?? '',
        releaseYear: game.releaseYear !== null && game.releaseYear !== undefined ? String(game.releaseYear) : '',
        status: game.status ?? '',
        rating: game.rating !== null && game.rating !== undefined ? String(game.rating) : '',
        developers: JSON.stringify(game.developers ?? []),
        franchises: JSON.stringify(game.franchises ?? []),
        genres: JSON.stringify(game.genres ?? []),
        publishers: JSON.stringify(game.publishers ?? []),
        tags: JSON.stringify(tagNames),
        name: '',
        color: '',
        groupBy: '',
        filters: '',
        key: '',
        value: '',
        createdAt: game.createdAt,
        updatedAt: game.updatedAt,
      });
    });

    tags.forEach(tag => {
      rows.push({
        type: 'tag',
        listType: '',
        igdbGameId: '',
        platformIgdbId: '',
        title: '',
        coverUrl: '',
        coverSource: '',
        platform: '',
        releaseDate: '',
        releaseYear: '',
        status: '',
        rating: '',
        developers: '',
        franchises: '',
        genres: '',
        publishers: '',
        tags: '',
        name: tag.name,
        color: tag.color,
        groupBy: '',
        filters: '',
        key: '',
        value: '',
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
      });
    });

    [...collectionViews, ...wishlistViews].forEach(view => {
      rows.push({
        type: 'view',
        listType: view.listType,
        igdbGameId: '',
        platformIgdbId: '',
        title: '',
        coverUrl: '',
        coverSource: '',
        platform: '',
        releaseDate: '',
        releaseYear: '',
        status: '',
        rating: '',
        developers: '',
        franchises: '',
        genres: '',
        publishers: '',
        tags: '',
        name: view.name,
        color: '',
        groupBy: view.groupBy,
        filters: JSON.stringify(view.filters),
        key: '',
        value: '',
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
      });
    });

    this.readExportableSettings().forEach(([key, value]) => {
      rows.push({
        type: 'setting',
        listType: '',
        igdbGameId: '',
        platformIgdbId: '',
        title: '',
        coverUrl: '',
        coverSource: '',
        platform: '',
        releaseDate: '',
        releaseYear: '',
        status: '',
        rating: '',
        developers: '',
        franchises: '',
        genres: '',
        publishers: '',
        tags: '',
        name: '',
        color: '',
        groupBy: '',
        filters: '',
        key,
        value,
        createdAt: '',
        updatedAt: '',
      });
    });

    const lines = [
      CSV_HEADERS.join(','),
      ...rows.map(row => CSV_HEADERS.map(header => this.escapeCsvValue(row[header])).join(',')),
    ];

    return lines.join('\n');
  }

  private async parseImportCsv(csv: string): Promise<ImportPreviewRow[]> {
    const table = this.parseCsvTable(csv);

    if (table.length < 2) {
      throw new Error('CSV must include header and at least one data row.');
    }

    const headers = table[0].map(cell => cell.trim());
    CSV_HEADERS.forEach(header => {
      if (!headers.includes(header)) {
        throw new Error(`Missing CSV column: ${header}`);
      }
    });

    const gamesInDb = await this.repository.listAll();
    const existingKeys = new Set(gamesInDb.map(game => `${game.igdbGameId}::${game.platformIgdbId}`));
    const pendingKeys = new Set<string>();
    const existingTags = await this.repository.listTags();
    const existingTagNames = new Set(
      existingTags.map(tag => tag.name.trim().toLowerCase()).filter(name => name.length > 0),
    );
    const pendingTagNames = new Set<string>();
    const [collectionViews, wishlistViews] = await Promise.all([
      this.repository.listViews('collection'),
      this.repository.listViews('wishlist'),
    ]);
    const existingViewNames = new Set(
      [...collectionViews, ...wishlistViews]
        .map(view => view.name.trim().toLowerCase())
        .filter(name => name.length > 0),
    );
    const pendingViewNames = new Set<string>();
    const rows: ImportPreviewRow[] = [];

    for (let index = 1; index < table.length; index += 1) {
      const values = table[index];

      if (values.every(value => value.trim().length === 0)) {
        continue;
      }

      const record = this.mapCsvRecord(headers, values);
      const rowNumber = index + 1;
      const preview = this.validateImportRecord(
        record,
        rowNumber,
        existingKeys,
        pendingKeys,
        existingTagNames,
        pendingTagNames,
        existingViewNames,
        pendingViewNames,
      );
      rows.push(preview);
    }

    return rows;
  }

  private validateImportRecord(
    record: ExportCsvRow,
    rowNumber: number,
    existingKeys: Set<string>,
    pendingKeys: Set<string>,
    existingTagNames: Set<string>,
    pendingTagNames: Set<string>,
    existingViewNames: Set<string>,
    pendingViewNames: Set<string>,
  ): ImportPreviewRow {
    const type = record.type;

    if (type !== 'game' && type !== 'tag' && type !== 'view' && type !== 'setting') {
      return {
        id: rowNumber,
        rowNumber,
        type: 'unknown',
        summary: `Row ${rowNumber}`,
        error: 'Unknown row type.',
        warning: null,
        parsed: null,
      };
    }

    if (type === 'setting') {
      if (record.key.trim().length === 0) {
        return this.errorRow(type, rowNumber, 'Setting key is required.');
      }

      return {
        id: rowNumber,
        rowNumber,
        type,
        summary: `Setting: ${record.key}`,
        error: null,
        warning: null,
        parsed: {
          kind: 'setting',
          key: record.key,
          value: record.value,
        },
      };
    }

    if (type === 'tag') {
      const name = record.name.trim();
      const color = this.normalizeColor(record.color);

      if (name.length === 0) {
        return this.errorRow(type, rowNumber, 'Tag name is required.');
      }
      const warning = this.buildDuplicateNameWarning(name, existingTagNames, pendingTagNames, 'tag');

      return {
        id: rowNumber,
        rowNumber,
        type,
        summary: `Tag: ${name}`,
        error: null,
        warning,
        parsed: {
          kind: 'tag',
          name,
          color,
        },
      };
    }

    if (type === 'view') {
      const listType = this.normalizeListType(record.listType);
      const groupBy = this.normalizeGroupBy(record.groupBy);
      const name = record.name.trim();

      if (name.length === 0) {
        return this.errorRow(type, rowNumber, 'View name is required.');
      }

      if (!listType) {
        return this.errorRow(type, rowNumber, 'View list type must be collection or wishlist.');
      }

      if (!groupBy) {
        return this.errorRow(type, rowNumber, 'Invalid groupBy value.');
      }

      const filters = this.parseFilters(record.filters);

      if (!filters) {
        return this.errorRow(type, rowNumber, 'Invalid filters payload for view.');
      }
      const warning = this.buildDuplicateNameWarning(name, existingViewNames, pendingViewNames, 'view');

      return {
        id: rowNumber,
        rowNumber,
        type,
        summary: `View: ${name} (${listType})`,
        error: null,
        warning,
        parsed: {
          kind: 'view',
          name,
          listType,
          groupBy,
          filters,
        },
      };
    }

    const listType = this.normalizeListType(record.listType);

    if (!listType) {
      return this.errorRow(type, rowNumber, 'Game list type must be collection or wishlist.');
    }

    const igdbGameId = record.igdbGameId.trim();

    if (!/^\d+$/.test(igdbGameId)) {
      return this.errorRow(type, rowNumber, 'Game IGDB id is required and must be numeric.');
    }

    const platformIgdbId = Number.parseInt(record.platformIgdbId, 10);

    if (!Number.isInteger(platformIgdbId) || platformIgdbId <= 0) {
      return this.errorRow(type, rowNumber, 'Game platform IGDB id is required and must be positive.');
    }

    const key = `${igdbGameId}::${platformIgdbId}`;

    if (existingKeys.has(key)) {
      return this.errorRow(type, rowNumber, 'Duplicate game already exists in your library. Remove this row.');
    }

    if (pendingKeys.has(key)) {
      return this.errorRow(type, rowNumber, 'Duplicate game also exists in this import file. Remove one row.');
    }

    pendingKeys.add(key);

    const platform = record.platform.trim();

    if (platform.length === 0) {
      return this.errorRow(type, rowNumber, 'Platform is required for imported games.');
    }

    const status = this.normalizeStatus(record.status);

    if (record.status.trim().length > 0 && status === null) {
      return this.errorRow(type, rowNumber, 'Invalid status value.');
    }

    const rating = this.normalizeRating(record.rating);

    if (record.rating.trim().length > 0 && rating === null) {
      return this.errorRow(type, rowNumber, 'Rating must be none or an integer between 1 and 5.');
    }

    const catalog: GameCatalogResult = {
      igdbGameId,
      title: record.title.trim() || 'Unknown title',
      coverUrl: record.coverUrl.trim() || null,
      coverSource: this.normalizeCoverSource(record.coverSource),
      developers: this.parseStringArray(record.developers),
      franchises: this.parseStringArray(record.franchises),
      genres: this.parseStringArray(record.genres),
      publishers: this.parseStringArray(record.publishers),
      platforms: [platform],
      platformOptions: [{ id: platformIgdbId, name: platform }],
      platform,
      platformIgdbId,
      releaseDate: record.releaseDate.trim().length > 0 ? record.releaseDate.trim() : null,
      releaseYear: this.parseOptionalNumber(record.releaseYear),
    };

    const tagNames = this.parseStringArray(record.tags);

    return {
      id: rowNumber,
      rowNumber,
      type,
      summary: `Game: ${catalog.title} (${platform})`,
      error: null,
      warning: null,
      parsed: {
        kind: 'game',
        listType,
        catalog,
        status,
        rating,
        tagNames,
      },
    };
  }

  private errorRow(type: ExportRowType, rowNumber: number, error: string): ImportPreviewRow {
    return {
      id: rowNumber,
      rowNumber,
      type,
      summary: `${type.toUpperCase()} row ${rowNumber}`,
      error,
      warning: null,
      parsed: null,
    };
  }

  private buildDuplicateNameWarning(
    name: string,
    existingNames: Set<string>,
    pendingNames: Set<string>,
    entityLabel: 'tag' | 'view',
  ): string | null {
    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();

    if (trimmed.length === 0) {
      return null;
    }

    const usedNames = new Set<string>([...existingNames, ...pendingNames]);
    const resolved = this.resolveUniqueName(trimmed, usedNames);
    pendingNames.add(resolved.toLowerCase());

    if (resolved === trimmed) {
      return null;
    }

    return `Duplicate ${entityLabel} name found. This row will be imported as "${resolved}".`;
  }

  private parseCsvTable(csv: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < csv.length; i += 1) {
      const char = csv[i];
      const nextChar = csv[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }

        continue;
      }

      if (char === ',' && !inQuotes) {
        row.push(cell);
        cell = '';
        continue;
      }

      if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i += 1;
        }

        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        continue;
      }

      cell += char;
    }

    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }

    return rows;
  }

  private mapCsvRecord(headers: string[], values: string[]): ExportCsvRow {
    const getValue = (header: keyof ExportCsvRow) => {
      const index = headers.indexOf(header);
      return index >= 0 ? (values[index] ?? '') : '';
    };

    return {
      type: (getValue('type') as ExportRowType) ?? 'game',
      listType: getValue('listType'),
      igdbGameId: getValue('igdbGameId'),
      platformIgdbId: getValue('platformIgdbId'),
      title: getValue('title'),
      coverUrl: getValue('coverUrl'),
      coverSource: getValue('coverSource'),
      platform: getValue('platform'),
      releaseDate: getValue('releaseDate'),
      releaseYear: getValue('releaseYear'),
      status: getValue('status'),
      rating: getValue('rating'),
      developers: getValue('developers'),
      franchises: getValue('franchises'),
      genres: getValue('genres'),
      publishers: getValue('publishers'),
      tags: getValue('tags'),
      name: getValue('name'),
      color: getValue('color'),
      groupBy: getValue('groupBy'),
      filters: getValue('filters'),
      key: getValue('key'),
      value: getValue('value'),
      createdAt: getValue('createdAt'),
      updatedAt: getValue('updatedAt'),
    };
  }

  private parseStringArray(raw: string): string[] {
    if (raw.trim().length === 0) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return [...new Set(
        parsed
          .map(value => (typeof value === 'string' ? value.trim() : ''))
          .filter(value => value.length > 0)
      )];
    } catch {
      return [];
    }
  }

  private parseFilters(raw: string): GameListFilters | null {
    if (raw.trim().length === 0) {
      return { ...DEFAULT_GAME_LIST_FILTERS };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<GameListFilters>;

      return {
        ...DEFAULT_GAME_LIST_FILTERS,
        ...parsed,
        platform: Array.isArray(parsed.platform) ? parsed.platform.filter(value => typeof value === 'string') : [],
        genres: Array.isArray(parsed.genres) ? parsed.genres.filter(value => typeof value === 'string') : [],
        statuses: Array.isArray(parsed.statuses)
          ? parsed.statuses.filter(value => value === 'none' || value === 'playing' || value === 'wantToPlay' || value === 'completed' || value === 'paused' || value === 'dropped' || value === 'replay')
          : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter(value => typeof value === 'string') : [],
        ratings: Array.isArray(parsed.ratings)
          ? parsed.ratings.filter(value => value === 'none' || value === 1 || value === 2 || value === 3 || value === 4 || value === 5)
          : [],
        sortField: parsed.sortField === 'title' || parsed.sortField === 'releaseDate' || parsed.sortField === 'createdAt' || parsed.sortField === 'platform'
          ? parsed.sortField
          : DEFAULT_GAME_LIST_FILTERS.sortField,
        sortDirection: parsed.sortDirection === 'desc' ? 'desc' : 'asc',
        releaseDateFrom: typeof parsed.releaseDateFrom === 'string' ? parsed.releaseDateFrom : null,
        releaseDateTo: typeof parsed.releaseDateTo === 'string' ? parsed.releaseDateTo : null,
      };
    } catch {
      return null;
    }
  }

  private parseOptionalNumber(value: string): number | null {
    const normalized = value.trim();

    if (normalized.length === 0) {
      return null;
    }

    const parsed = Number.parseInt(normalized, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  private normalizeListType(value: string): ListType | null {
    return value === 'collection' || value === 'wishlist' ? value : null;
  }

  private normalizeGroupBy(value: string): GameGroupByField | null {
    if (
      value === 'none'
      || value === 'platform'
      || value === 'developer'
      || value === 'franchise'
      || value === 'tag'
      || value === 'genre'
      || value === 'publisher'
      || value === 'releaseYear'
    ) {
      return value;
    }

    return null;
  }

  private normalizeStatus(value: string): GameStatus | null {
    if (
      value === 'completed'
      || value === 'dropped'
      || value === 'playing'
      || value === 'paused'
      || value === 'replay'
      || value === 'wantToPlay'
    ) {
      return value;
    }

    return null;
  }

  private normalizeRating(value: string): GameRating | null {
    const normalized = value.trim();

    if (normalized.length === 0) {
      return null;
    }

    const parsed = Number.parseInt(normalized, 10);

    if (parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 || parsed === 5) {
      return parsed;
    }

    return null;
  }

  private normalizeCoverSource(value: string): 'thegamesdb' | 'igdb' | 'none' {
    if (value === 'thegamesdb' || value === 'igdb' || value === 'none') {
      return value;
    }

    return 'none';
  }

  private normalizeColor(value: string): string {
    return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : '#3880ff';
  }

  private readExportableSettings(): Array<[string, string]> {
    const entries: Array<[string, string]> = [];

    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);

        if (!key || !key.startsWith('game-shelf')) {
          continue;
        }

        const value = localStorage.getItem(key);

        if (typeof value === 'string') {
          entries.push([key, value]);
        }
      }
    } catch {
      // Ignore storage read issues.
    }

    const colorKey = 'game-shelf-primary-color';

    if (!entries.some(([key]) => key === colorKey)) {
      entries.push([colorKey, this.themeService.getPrimaryColor()]);
    }

    return entries;
  }

  private applyImportedSettings(rows: ParsedSettingImportRow[]): void {
    rows.forEach(row => {
      try {
        localStorage.setItem(row.key, row.value);
      } catch {
        // Ignore storage write failures.
      }

      if (row.key === 'game-shelf-primary-color') {
        this.themeService.setPrimaryColor(row.value);
      }
    });
  }

  private async buildTagNameToIdMap(): Promise<Map<string, number>> {
    const tags = await this.repository.listTags();
    const map = new Map<string, number>();

    tags.forEach(tag => {
      if (typeof tag.id === 'number' && tag.id > 0) {
        map.set(tag.name.toLowerCase(), tag.id);
      }
    });

    return map;
  }

  private normalizeTagIds(tagIds: number[] | undefined): number[] {
    if (!Array.isArray(tagIds)) {
      return [];
    }

    return [...new Set(tagIds.filter(value => Number.isInteger(value) && value > 0))];
  }

  private resolveUniqueName(name: string, usedNamesLowercase: Set<string>): string {
    const trimmed = name.trim();
    const baseName = trimmed.length > 0 ? trimmed : 'Untitled';
    const baseLower = baseName.toLowerCase();

    if (!usedNamesLowercase.has(baseLower)) {
      usedNamesLowercase.add(baseLower);
      return baseName;
    }

    let suffix = 2;
    while (suffix < 10000) {
      const candidate = `${baseName} (${suffix})`;
      const candidateLower = candidate.toLowerCase();
      if (!usedNamesLowercase.has(candidateLower)) {
        usedNamesLowercase.add(candidateLower);
        return candidate;
      }
      suffix += 1;
    }

    const fallback = `${baseName} (${Date.now()})`;
    usedNamesLowercase.add(fallback.toLowerCase());
    return fallback;
  }

  private escapeCsvValue(value: string): string {
    const normalized = String(value ?? '');

    if (normalized.includes(',') || normalized.includes('"') || normalized.includes('\n') || normalized.includes('\r')) {
      return `"${normalized.replace(/"/g, '""')}"`;
    }

    return normalized;
  }

  private async presentShareDialog(csv: string, filename: string): Promise<void> {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const file = new File([blob], filename, { type: 'text/csv' });

    const capacitorShare = (window as { Capacitor?: { Plugins?: { Share?: { share: (options: { title?: string; text?: string; url?: string; dialogTitle?: string }) => Promise<void> } } } }).Capacitor?.Plugins?.Share;

    if (capacitorShare?.share) {
      const objectUrl = URL.createObjectURL(blob);

      try {
        await capacitorShare.share({
          title: 'Game Shelf Export',
          text: 'Game Shelf CSV export',
          url: objectUrl,
          dialogTitle: 'Export CSV',
        });
        return;
      } catch {
        // Fall through to next strategy.
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    const webNavigator = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; files?: File[] }) => Promise<void>;
      canShare?: (data: { files?: File[] }) => boolean;
    };

    if (typeof webNavigator.share === 'function') {
      const canShareFiles = typeof webNavigator.canShare !== 'function' || webNavigator.canShare({ files: [file] });

      if (canShareFiles) {
        await webNavigator.share({
          title: 'Game Shelf Export',
          text: 'Game Shelf CSV export',
          files: [file],
        });
        return;
      }
    }

    const objectUrl = URL.createObjectURL(blob);

    try {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.click();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  private findPresetColor(color: string): string | null {
    return this.presets.find(preset => preset.value === color)?.value ?? null;
  }

  private async presentToast(message: string, color: 'primary' | 'danger' | 'warning' = 'primary'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 1800,
      position: 'bottom',
      color,
    });

    await toast.present();
  }
}
