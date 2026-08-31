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

async function expectMinimumWidth(button: Locator, minimum: number): Promise<void> {
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The action button geometry was unavailable.');
  expect(box.width).toBeGreaterThan(minimum);
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
  await expect(dialog.getByText('Criterion', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Minimum requirement', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Measure', { exact: true })).toHaveCount(0);
  await expect(page.locator('#qualification-training-hours')).toHaveAttribute(
    'aria-describedby',
    'qualification-training-hours-unit',
  );
  await expect(page.locator('#qualification-training-hours').locator('..')).toContainText('hours');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveClass(/bg-canvas/);
  await expectMinimumWidth(page.getByRole('button', { name: 'Cancel', exact: true }), 64);
  await expectMinimumWidth(page.getByRole('button', { name: 'Create Draft', exact: true }), 96);
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
  for (const label of ['Details', 'Edit Draft', 'Validate Evidence']) {
    await expect(row.getByRole('button', { name: label })).toHaveClass(/bg-canvas/);
  }
  await expect(trigger).toBeFocused();

  await row.getByRole('button', { name: code }).click();
  const detailDialog = page.getByRole('dialog', { name: 'Qualification Standard · ' + code });
  await expect(detailDialog).toContainText('Version 1');
  await expect(detailDialog).toContainText('Training hours');
  await expect(detailDialog).toContainText('Source External Evidence');
  await detailDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(row.getByRole('button', { name: code })).toBeFocused();

  await row.getByRole('button', { name: 'Edit Draft' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit Draft Qualification Standard' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByText('Criterion', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Qualification Standard code')).toHaveCount(0);
  await expect(page.getByLabel('Effective date')).toHaveValue(/\d{4}-\d{2}-\d{2}/);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(editDialog).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expectCenteredDialog(dialog, 390);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});
