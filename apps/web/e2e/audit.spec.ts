import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Audit Event dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
  expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
}

async function expectFocusInside(dialog: Locator): Promise<void> {
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

test('reads persisted Organization Unit evidence in a keyboard-safe detail dialog', async ({
  page,
}, testInfo) => {
  const code = `AUDIT-${Date.now()}`;

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/audit');
  await expect(
    page.getByText('No Organization Unit audit events yet.', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('empty.png'), fullPage: true });

  await page.goto('/organization');
  await page.getByRole('button', { name: 'Create Organization Unit' }).click();
  await page.getByLabel('Official name').fill('Audit Evidence Office');
  await page.getByLabel('Agency-unique code').fill(code);
  await page.getByRole('button', { name: 'Create Draft' }).click();
  await expect(page.getByRole('status')).toContainText('was created.');

  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
  const event = page.getByRole('button').filter({ hasText: 'ORGANIZATION_UNIT_CREATED' }).first();
  await expect(event).toContainText('None → DRAFT');
  await page.screenshot({ path: testInfo.outputPath('list.png'), fullPage: true });

  await event.click();
  const dialog = page.getByRole('dialog', { name: 'Audit Event detail' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    'Inspect persisted evidence from the active Agency Context.',
  );
  await expect(page.getByText('Request ID', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('ORGANIZATION_UNIT_CREATED');
  await expect(dialog).toContainText('None → DRAFT');
  await expect(dialog).toContainText('Audit Evidence Office');
  await expect(page.getByRole('button', { name: 'Close audit event detail' })).toBeFocused();
  await expectCenteredDialog(dialog, page.viewportSize()?.width ?? 1280);
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('detail.png'), fullPage: true });

  await page.setViewportSize({ width: 800, height: 900 });
  await expectCenteredDialog(dialog, 800);
  await page.screenshot({ path: testInfo.outputPath('narrow-modal.png'), fullPage: true });
  await page.keyboard.press('Tab');
  await expectFocusInside(dialog);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(event).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('narrow.png'), fullPage: true });
});
