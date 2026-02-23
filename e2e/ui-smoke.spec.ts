import { expect, test, type Page } from '@playwright/test';

async function dismissVersionAlertIfPresent(page: Page): Promise<void> {
  const versionAlert = page.getByRole('alertdialog', { name: 'App Updated' });

  if (await versionAlert.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(versionAlert).toBeHidden();
  }
}

async function openFiltersMenu(page: Page): Promise<void> {
  await page.locator('ion-button.filters-button').click();
  await expect(page.locator('ion-menu .actions ion-button', { hasText: 'Done' })).toBeVisible();
}

async function closeFiltersMenu(page: Page): Promise<void> {
  await page.locator('ion-menu .actions ion-button', { hasText: 'Done' }).click();
  await expect(page.locator('ion-menu .actions ion-button', { hasText: 'Done' })).toBeHidden();
}

async function setSingleSelectValue(
  page: Page,
  selectLabel: 'Sort' | 'Group by',
  optionLabel: string
): Promise<void> {
  const select = page.locator(`ion-menu ion-select[label="${selectLabel}"]`);
  await select.click();

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
  await select.click();

  const alert = page.locator('ion-alert').last();
  await expect(alert).toBeVisible();
  await alert.getByRole('checkbox', { name: optionLabel }).click();
  await alert.getByRole('button', { name: 'OK' }).click();
  await expect(alert).toBeHidden();
}

async function expectPersistedFilterControls(page: Page): Promise<void> {
  const sortSelect = page.locator('ion-menu ion-select[label="Sort"]');
  const groupBySelect = page.locator('ion-menu ion-select[label="Group by"]');
  const hltbMinInput = page.locator('ion-menu ion-input[label="HLTB main min (hours)"]');
  const releaseDateFrom = page.locator('ion-menu ion-datetime[id$="release-date-from"]');

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
  const sortSelect = page.locator('ion-menu ion-select[label="Sort"]');
  const groupBySelect = page.locator('ion-menu ion-select[label="Group by"]');
  const statusSelect = page.locator('ion-menu ion-select[label="Status"]');

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
  await expect(page.locator('ion-button.filters-button')).toBeVisible();
  await expect(page.locator('ion-fab-button[color=\"primary\"]')).toBeVisible();
});

test('filter menu shows reset and done on same row', async ({ page }) => {
  await page.goto('/tabs/collection');
  await dismissVersionAlertIfPresent(page);
  await page.locator('ion-button.filters-button').click();

  const reset = page.locator('ion-menu .actions ion-button', { hasText: 'Reset' });
  const done = page.locator('ion-menu .actions ion-button', { hasText: 'Done' });

  await expect(reset).toBeVisible();
  await expect(done).toBeVisible();

  const [resetBox, doneBox] = await Promise.all([reset.boundingBox(), done.boundingBox()]);
  expect(resetBox).not.toBeNull();
  expect(doneBox).not.toBeNull();

  if (!resetBox || !doneBox) {
    return;
  }

  expect(Math.abs(resetBox.y - doneBox.y)).toBeLessThan(8);
});

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
