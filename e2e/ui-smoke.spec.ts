import { expect, test, type Locator, type Page } from '@playwright/test';

type ViewportMode = 'desktop' | 'mobile';

const viewportByMode: Record<ViewportMode, { width: number; height: number }> = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 }
};

async function dismissVersionAlertIfPresent(page: Page): Promise<void> {
  const versionAlert = page.getByRole('alertdialog', { name: 'App Updated' });
  const okButton = page.getByRole('button', { name: 'OK' });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const visible = await versionAlert.isVisible({ timeout: 2500 }).catch(() => false);
    if (!visible) {
      return;
    }

    await okButton.click();
    await expect(versionAlert).toBeHidden();
  }
}

async function dismissAnyVisibleAlertIfPresent(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const alert = page.locator('ion-alert').last();
    const isVisible = await alert.isVisible({ timeout: 1200 }).catch(() => false);

    if (!isVisible) {
      return;
    }

    const okButton = page.getByRole('button', { name: 'OK' });
    if (await okButton.isVisible().catch(() => false)) {
      await okButton.click();
      await expect(alert).toBeHidden();
      continue;
    }

    return;
  }
}

async function openFiltersMenu(page: Page): Promise<void> {
  const filtersButton = page.locator('ion-button.filters-button');
  const splitSortSelect = page.locator('app-game-filters-menu ion-select[label="Sort"]');

  const mode = await expect
    .poll(
      async () => {
        if (await filtersButton.isVisible().catch(() => false)) {
          return 'overlay';
        }

        if (await splitSortSelect.isVisible().catch(() => false)) {
          return 'split';
        }

        return 'pending';
      },
      { timeout: 10000 }
    )
    .not.toBe('pending')
    .then(() => {
      return filtersButton.isVisible().catch(() => false);
    });

  if (mode) {
    await filtersButton.click();
    await expect(page.locator('ion-menu .actions ion-button', { hasText: 'Done' })).toBeVisible();
    return;
  }

  await expect(splitSortSelect).toBeVisible();
}

async function closeFiltersMenu(page: Page): Promise<void> {
  const doneButton = page.locator('ion-menu .actions ion-button', { hasText: 'Done' });
  const hasDoneButton = await doneButton.isVisible().catch(() => false);

  if (!hasDoneButton) {
    return;
  }

  await doneButton.click();
  await expect(doneButton).toBeHidden();
}

async function openCollectionInMode(page: Page, mode: ViewportMode): Promise<void> {
  const viewport = viewportByMode[mode];
  await page.setViewportSize(viewport);
  await page.goto('/tabs/collection');
  await dismissVersionAlertIfPresent(page);
}

async function setE2eFixtureGames(
  page: Page,
  games: Array<{
    igdbGameId: string;
    platformIgdbId: number;
    title: string;
    platform?: string;
    listType?: 'collection' | 'wishlist';
    notes?: string | null;
  }>
): Promise<void> {
  await page.addInitScript(
    (payload) => {
      window.localStorage.setItem('game-shelf:e2e-fixture', JSON.stringify(payload));
    },
    { resetDb: true, games }
  );
}

async function openFirstGameDetail(page: Page, listType: 'collection' | 'wishlist'): Promise<void> {
  await page.goto(`/tabs/${listType}`);
  await dismissVersionAlertIfPresent(page);
  await dismissAnyVisibleAlertIfPresent(page);

  const firstGameRow = page.locator('app-game-list ion-item-sliding ion-item[button]').first();
  await expect(firstGameRow).toBeVisible();
  try {
    await firstGameRow.click({ timeout: 5000 });
  } catch {
    await dismissAnyVisibleAlertIfPresent(page);
    await firstGameRow.click();
  }
  await expect(page.locator('ion-modal.desktop-fullscreen-modal')).toBeVisible();
}

async function openDetailShortcuts(page: Page): Promise<void> {
  const shortcutsToggle = page.getByRole('button', { name: 'Open web shortcuts' });
  await shortcutsToggle.click();
}

async function openNotesFromDetail(page: Page): Promise<void> {
  await openDetailShortcuts(page);
  await page.getByRole('button', { name: 'Open notes editor' }).click();
}

async function closeNotesWhenSaveCompletes(notesCloseButton: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          await notesCloseButton.click({ timeout: 300 });
        } catch {
          return false;
        }

        return notesCloseButton.isVisible().catch(() => false);
      },
      { timeout: 12000, intervals: [250, 400, 600, 800, 1000] }
    )
    .toBe(false);
}

async function expectNotesCloseBlockedToast(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const savingToastVisible = await page
          .locator('ion-toast', { hasText: 'Notes are still saving. Please wait a moment.' })
          .isVisible()
          .catch(() => false);
        if (savingToastVisible) {
          return true;
        }

        return page
          .locator('ion-toast', {
            hasText: 'Notes have unsaved changes. Please wait for auto-save.'
          })
          .isVisible()
          .catch(() => false);
      },
      { timeout: 5000 }
    )
    .toBe(true);
}

async function setSingleSelectValue(
  page: Page,
  selectLabel: 'Sort' | 'Group by',
  optionLabel: string
): Promise<void> {
  const select = page.locator(`ion-menu ion-select[label="${selectLabel}"]`);
  if (!(await select.isVisible().catch(() => false))) {
    const splitSelect = page.locator(`app-game-filters-menu ion-select[label="${selectLabel}"]`);
    await splitSelect.click();
  } else {
    await select.click();
  }

  const alert = page.locator('ion-alert').last();
  await expect(alert).toBeVisible();
  await alert.getByRole('radio', { name: optionLabel }).click();
  await alert.getByRole('button', { name: 'OK' }).click();
  await expect(alert).toBeHidden();
}

async function setMultiSelectValue(
  page: Page,
  selectLabel: 'Status',
  optionLabel: string
): Promise<void> {
  const select = page.locator(`ion-menu ion-select[label="${selectLabel}"]`);
  if (!(await select.isVisible().catch(() => false))) {
    const splitSelect = page.locator(`app-game-filters-menu ion-select[label="${selectLabel}"]`);
    await splitSelect.click();
  } else {
    await select.click();
  }

  const alert = page.locator('ion-alert').last();
  await expect(alert).toBeVisible();
  await alert.getByRole('checkbox', { name: optionLabel }).click();
  await alert.getByRole('button', { name: 'OK' }).click();
  await expect(alert).toBeHidden();
}

async function expectPersistedFilterControls(page: Page): Promise<void> {
  const sortSelect = page.locator('app-game-filters-menu ion-select[label="Sort"]');
  const groupBySelect = page.locator('app-game-filters-menu ion-select[label="Group by"]');
  const hltbMinInput = page.locator(
    'app-game-filters-menu ion-input[label="HLTB main min (hours)"]'
  );
  const releaseDateFrom = page.locator(
    'app-game-filters-menu ion-datetime[id$="release-date-from"]'
  );

  await expect
    .poll(async () =>
      sortSelect.evaluate((element) => String((element as { value: unknown }).value))
    )
    .toBe('platform:desc');
  await expect
    .poll(async () =>
      groupBySelect.evaluate((element) => String((element as { value: unknown }).value))
    )
    .toBe('genre');
  await expect
    .poll(async () =>
      hltbMinInput.evaluate((element) => String((element as { value: unknown }).value))
    )
    .toBe('12.5');
  await expect
    .poll(async () =>
      releaseDateFrom.evaluate((element) => String((element as { value: unknown }).value))
    )
    .toBe('2020-01-01');
}

async function expectUiUpdatedFilterControls(page: Page): Promise<void> {
  const sortSelect = page.locator('app-game-filters-menu ion-select[label="Sort"]');
  const groupBySelect = page.locator('app-game-filters-menu ion-select[label="Group by"]');
  const statusSelect = page.locator('app-game-filters-menu ion-select[label="Status"]');

  await expect
    .poll(async () =>
      sortSelect.evaluate((element) => String((element as { value: unknown }).value))
    )
    .toBe('releaseDate:desc');
  await expect
    .poll(async () =>
      groupBySelect.evaluate((element) => String((element as { value: unknown }).value))
    )
    .toBe('publisher');
  await expect
    .poll(async () =>
      statusSelect.evaluate((element) => JSON.stringify((element as { value: unknown }).value))
    )
    .toContain('playing');
}

test('collection page loads core controls', async ({ page }) => {
  await page.goto('/tabs/collection');
  await dismissVersionAlertIfPresent(page);

  await expect(page.locator('ion-title .page-title', { hasText: 'Collection' })).toBeVisible();
  await expect(page.getByPlaceholder('Search collection')).toBeVisible();
  const hasFiltersButton = await page
    .locator('ion-button.filters-button')
    .isVisible()
    .catch(() => false);

  if (hasFiltersButton) {
    await expect(page.locator('ion-fab-button[color=\"primary\"]')).toBeVisible();
  } else {
    await expect(page.locator('app-game-filters-menu ion-select[label=\"Sort\"]')).toBeVisible();
  }
});

test('filter menu shows reset and done on same row', async ({ page }) => {
  await page.goto('/tabs/collection');
  await dismissVersionAlertIfPresent(page);

  const filtersButton = page.locator('ion-button.filters-button');
  const hasFiltersButton = await filtersButton.isVisible().catch(() => false);

  if (hasFiltersButton) {
    await filtersButton.click();
  }

  const reset = page.locator('app-game-filters-menu .actions ion-button', { hasText: 'Reset' });
  const done = page.locator('ion-menu .actions ion-button', { hasText: 'Done' });

  await expect(reset).toBeVisible();
  if (!(await done.isVisible().catch(() => false))) {
    return;
  }

  const [resetBox, doneBox] = await Promise.all([reset.boundingBox(), done.boundingBox()]);
  expect(resetBox).not.toBeNull();
  expect(doneBox).not.toBeNull();

  if (!resetBox || !doneBox) {
    return;
  }

  expect(Math.abs(resetBox.y - doneBox.y)).toBeLessThan(8);
});

test('mobile viewport uses overlay filters menu and Done closes it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tabs/collection');
  await dismissVersionAlertIfPresent(page);

  await expect(page.locator('ion-split-pane.list-page-split-pane')).toHaveCount(0);

  await openFiltersMenu(page);
  await closeFiltersMenu(page);
});

test('desktop renders split pane while mobile does not render split pane', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/tabs/collection');
  await dismissVersionAlertIfPresent(page);
  const splitPane = page.locator('ion-split-pane.list-page-split-pane');
  await expect(splitPane).toHaveCount(1);
  const wideViewportVisible = await splitPane.evaluate(
    (element) => (element as { visible: boolean }).visible
  );
  expect(wideViewportVisible).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(splitPane).toHaveCount(0);
  await expect(page.locator('ion-tab-bar[slot="bottom"]')).toBeVisible();
});

for (const mode of ['desktop', 'mobile'] as const) {
  test(`collection search input updates and clears (${mode})`, async ({ page }) => {
    await openCollectionInMode(page, mode);
    const searchbar = page.getByPlaceholder('Search collection');
    await expect(searchbar).toBeVisible();
    await searchbar.fill('metroid');
    await expect(searchbar).toHaveValue('metroid');

    await searchbar.fill('');
    await expect(searchbar).toHaveValue('');
  });

  test(`collection filter sort persists after reload (${mode})`, async ({ page }) => {
    await openCollectionInMode(page, mode);
    await openFiltersMenu(page);
    await setSingleSelectValue(page, 'Sort', 'Release date ↓');
    await closeFiltersMenu(page);

    await page.reload();
    await dismissVersionAlertIfPresent(page);
    await openFiltersMenu(page);

    const sortSelect = page.locator('app-game-filters-menu ion-select[label="Sort"]');
    await expect
      .poll(async () =>
        sortSelect.evaluate((element) => String((element as { value: unknown }).value))
      )
      .toBe('releaseDate:desc');
  });

  test(`collection does not render inline detail pane by default (${mode})`, async ({ page }) => {
    await openCollectionInMode(page, mode);
    await expect(page.locator('app-game-list app-game-detail-content')).toHaveCount(0);
  });
}

test('settings page shows metadata validator and import export entries', async ({ page }) => {
  await page.goto('/settings');
  await dismissVersionAlertIfPresent(page);

  await expect(page.locator('ion-list-header', { hasText: 'Theme' })).toBeVisible();
  await expect(page.locator('ion-list-header', { hasText: 'Data' })).toBeVisible();
  await expect(page.locator('ion-item', { hasText: 'Metadata Validator' })).toBeVisible();
  await expect(page.locator('ion-list-header', { hasText: 'Import/Export' })).toBeVisible();
  await expect(page.locator('ion-item', { hasText: 'Export CSV' })).toBeVisible();
  await expect(page.locator('ion-item', { hasText: 'Import CSV' })).toBeVisible();
  await expect(page.locator('ion-item', { hasText: 'Import MGC CSV' })).not.toBeVisible();
});

test('restores persisted sort/group/filter controls after reload', async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: 'game-shelf:preferences:collection',
      value: {
        filters: {
          sortField: 'platform',
          sortDirection: 'desc',
          platform: [],
          collections: [],
          developers: [],
          franchises: [],
          publishers: [],
          gameTypes: [],
          genres: [],
          statuses: ['playing'],
          tags: [],
          ratings: [],
          hltbMainHoursMin: 12.5,
          hltbMainHoursMax: null,
          releaseDateFrom: '2020-01-01',
          releaseDateTo: null
        },
        groupBy: 'genre',
        // Legacy top-level fields are written by the app and retained for compatibility.
        sortField: 'platform',
        sortDirection: 'desc'
      }
    }
  );

  await page.goto('/tabs/collection');
  await dismissVersionAlertIfPresent(page);

  await openFiltersMenu(page);
  await expectPersistedFilterControls(page);

  await page.reload();
  await dismissVersionAlertIfPresent(page);

  await openFiltersMenu(page);
  await expectPersistedFilterControls(page);
});

test('persists sort/group/filter changes made from UI after reload', async ({ page }) => {
  await page.goto('/tabs/collection');
  await dismissVersionAlertIfPresent(page);

  await openFiltersMenu(page);

  await setSingleSelectValue(page, 'Sort', 'Release date ↓');
  await setSingleSelectValue(page, 'Group by', 'Publisher');
  await setMultiSelectValue(page, 'Status', 'Playing');

  await closeFiltersMenu(page);
  await page.reload();
  await dismissVersionAlertIfPresent(page);

  await openFiltersMenu(page);
  await expectUiUpdatedFilterControls(page);
});

test('persists sort/group/filter changes on wishlist after reload', async ({ page }) => {
  await page.goto('/tabs/wishlist');
  await dismissVersionAlertIfPresent(page);

  await openFiltersMenu(page);

  await setSingleSelectValue(page, 'Sort', 'Release date ↓');
  await setSingleSelectValue(page, 'Group by', 'Publisher');
  await setMultiSelectValue(page, 'Status', 'Playing');

  await closeFiltersMenu(page);
  await page.reload();
  await dismissVersionAlertIfPresent(page);

  await openFiltersMenu(page);
  await expectUiUpdatedFilterControls(page);
});

test('collection detail shows notes shortcut while wishlist detail hides it', async ({ page }) => {
  await page.setViewportSize(viewportByMode.desktop);
  await setE2eFixtureGames(page, [
    {
      igdbGameId: '900001',
      platformIgdbId: 130,
      title: 'E2E Collection Game',
      listType: 'collection'
    },
    { igdbGameId: '900002', platformIgdbId: 130, title: 'E2E Wishlist Game', listType: 'wishlist' }
  ]);

  await openFirstGameDetail(page, 'collection');
  await openDetailShortcuts(page);
  await expect(page.getByRole('button', { name: 'Open notes editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Close game details' }).click();
  await expect(page.locator('ion-modal.desktop-fullscreen-modal')).toBeHidden();

  await openFirstGameDetail(page, 'wishlist');
  await openDetailShortcuts(page);
  await expect(page.getByRole('button', { name: 'Open notes editor' })).toHaveCount(0);
});

test('mobile notes modal blocks close while dirty and closes after autosave', async ({ page }) => {
  await page.setViewportSize(viewportByMode.mobile);
  await setE2eFixtureGames(page, [
    {
      igdbGameId: '900011',
      platformIgdbId: 130,
      title: 'E2E Mobile Notes Game',
      listType: 'collection'
    }
  ]);
  await openFirstGameDetail(page, 'collection');
  await openNotesFromDetail(page);

  const notesCloseButton = page.getByRole('button', { name: 'Close', exact: true });
  await expect(notesCloseButton).toBeVisible();

  const editor = page.locator('tiptap-editor.detail-note-editor .tiptap.ProseMirror');
  await editor.click();
  await page.keyboard.type('Unsaved mobile note change');

  await notesCloseButton.click();
  await expect(notesCloseButton).toBeVisible();
  await expectNotesCloseBlockedToast(page);

  await closeNotesWhenSaveCompletes(notesCloseButton);
});

test('desktop notes pane blocks notes/detail close while dirty and allows close after autosave', async ({
  page
}) => {
  await page.setViewportSize(viewportByMode.desktop);
  await setE2eFixtureGames(page, [
    {
      igdbGameId: '900021',
      platformIgdbId: 130,
      title: 'E2E Desktop Notes Game',
      listType: 'collection'
    }
  ]);
  await openFirstGameDetail(page, 'collection');
  await openNotesFromDetail(page);

  const notesCloseButton = page.getByRole('button', { name: 'Close', exact: true });
  await expect(notesCloseButton).toBeVisible();

  const editor = page.locator('tiptap-editor.detail-note-editor .tiptap.ProseMirror');
  await editor.click();
  await page.keyboard.type('Unsaved desktop note change');

  await notesCloseButton.click();
  await expect(notesCloseButton).toBeVisible();

  await page.getByRole('button', { name: 'Close game details' }).click();
  await expect(page.locator('ion-modal.desktop-fullscreen-modal')).toBeVisible();

  await closeNotesWhenSaveCompletes(notesCloseButton);
});

test('routes review refresh to Metacritic for supported platforms', async ({ page }) => {
  await page.setViewportSize(viewportByMode.desktop);
  await setE2eFixtureGames(page, [
    {
      igdbGameId: '910001',
      platformIgdbId: 21,
      title: 'E2E Supported Review Route',
      platform: 'Wii',
      listType: 'collection'
    }
  ]);

  let mobygamesRequestCount = 0;
  await page.route('**/v1/mobygames/search**', async (route) => {
    mobygamesRequestCount += 1;
    await route.fulfill({ status: 200, json: { games: [] } });
  });
  await page.route('**/v1/metacritic/search**', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        item: {
          metacriticScore: 90,
          metacriticUrl: 'https://www.metacritic.com/game/e2e-supported-review-route/'
        }
      }
    });
  });

  await openFirstGameDetail(page, 'collection');
  const metacriticRequestPromise = page.waitForRequest((request) => {
    return (
      request.url().includes('/v1/metacritic/search') && request.url().includes('platformIgdbId=21')
    );
  });

  await page.getByRole('button', { name: 'Game detail actions' }).click();
  const updateReviewItem = page.locator('ion-popover ion-item', { hasText: 'Update review data' });
  await expect(updateReviewItem).toBeVisible();
  await updateReviewItem.click();

  await metacriticRequestPromise;
  expect(mobygamesRequestCount).toBe(0);
});

test('routes review refresh to MobyGames for unsupported platforms', async ({ page }) => {
  await page.setViewportSize(viewportByMode.desktop);
  await setE2eFixtureGames(page, [
    {
      igdbGameId: '910002',
      platformIgdbId: 29,
      title: 'E2E Unsupported Review Route',
      platform: 'Genesis',
      listType: 'collection'
    }
  ]);

  let metacriticRequestCount = 0;
  await page.route('**/v1/metacritic/search**', async (route) => {
    metacriticRequestCount += 1;
    await route.fulfill({
      status: 200,
      json: {
        item: {
          metacriticScore: 0,
          metacriticUrl: null
        }
      }
    });
  });
  await page.route('**/v1/mobygames/search**', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        games: [
          {
            title: 'E2E Unsupported Review Route',
            release_date: '1992-03-20',
            platforms: [{ name: 'Genesis' }],
            moby_score: 83,
            moby_url: 'https://www.mobygames.com/game/910002/e2e-unsupported-review-route/'
          }
        ]
      }
    });
  });

  await openFirstGameDetail(page, 'collection');
  const mobygamesRequestPromise = page.waitForRequest((request) => {
    return (
      request.url().includes('/v1/mobygames/search') && request.url().includes('platform=Genesis')
    );
  });

  await page.getByRole('button', { name: 'Game detail actions' }).click();
  const updateReviewItem = page.locator('ion-popover ion-item', { hasText: 'Update review data' });
  await expect(updateReviewItem).toBeVisible();
  await updateReviewItem.click();

  await mobygamesRequestPromise;
  expect(metacriticRequestCount).toBe(0);
});
