import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Qualification Standard dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
  expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
}

async function expectFocusInside(dialog: Locator): Promise<void> {
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

test('creates a Draft Qualification Standard through the shared modal contract', async ({
  page,
}) => {
  const code = 'QS-E2E-' + Date.now();

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/qualification-standards');
  await expect(
    page.getByRole('heading', { name: 'Qualification Standards', exact: true }),
  ).toBeVisible();

  const trigger = page.getByRole('button', { name: 'Create Qualification Standard' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create Qualification Standard' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    'Record the requirements for one Draft version. The stable Standard remains inactive until both source and approval External Evidence are validated.',
  );
  await expect(page.getByLabel('Qualification Standard code')).toBeFocused();
  await expectCenteredDialog(dialog, page.viewportSize()?.width ?? 1280);

  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    await expectFocusInside(dialog);
  }

  await page.getByLabel('Qualification Standard code').fill(code);
  await page.getByLabel('Qualification Standard name').fill('E2E Qualification Standard');
  await page.getByLabel('Training hours required').fill('40');
  await page.getByRole('button', { name: 'Create Draft' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Draft Qualification Standard “' + code + '” was created.',
  );
  const row = page.getByRole('row').filter({ hasText: code });
  await expect(row).toContainText('INACTIVE');
  await expect(row).toContainText('v1');
  await expect(trigger).toBeFocused();

  await row.getByRole('button', { name: code }).click();
  const detailDialog = page.getByRole('dialog', { name: 'Qualification Standard · ' + code });
  await expect(detailDialog).toContainText('Version 1');
  await expect(detailDialog).toContainText('Training hours');
  await expect(detailDialog).toContainText('Source External Evidence');
  await detailDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(row.getByRole('button', { name: code })).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expectCenteredDialog(dialog, 390);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});
