import { expect, test, type Page } from '@playwright/test';

async function dismissVersionAlertIfPresent(page: Page): Promise<void> {
  const versionAlert = page.getByRole('alertdialog', { name: 'App Updated' });

  if (await versionAlert.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(versionAlert).toBeHidden();
  }
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
