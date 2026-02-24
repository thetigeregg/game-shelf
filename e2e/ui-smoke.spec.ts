import { expect, test, type Page } from '@playwright/test';

type ViewportMode = 'desktop' | 'mobile';

const viewportByMode: Record<ViewportMode, { width: number; height: number }> = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 }
};

async function dismissVersionAlertIfPresent(page: Page): Promise<void> {
  const versionAlert = page.getByRole('alertdialog', { name: 'App Updated' });

  if (await versionAlert.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(versionAlert).toBeHidden();
  }
}

async function openFiltersMenu(page: Page): Promise<void> {
  const filtersButton = page.locator('ion-button.filters-button');
  const hasFiltersButton = await filtersButton.isVisible().catch(() => false);

  if (hasFiltersButton) {
    await filtersButton.click();
    await expect(page.locator('ion-menu .actions ion-button', { hasText: 'Done' })).toBeVisible();
    return;
  }

  await expect(page.locator('app-game-filters-menu ion-select[label="Sort"]')).toBeVisible();
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
