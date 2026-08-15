import { expect, test } from '@playwright/test';

test('reads persisted Organization Unit evidence in a keyboard-safe detail panel', async ({
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
  const panel = page.getByRole('dialog', { name: 'Audit Event detail' });
  await expect(panel).toBeVisible();
  await expect(page.getByText('Request ID', { exact: true })).toBeVisible();
  await expect(panel).toContainText('ORGANIZATION_UNIT_CREATED');
  await expect(panel).toContainText('None → DRAFT');
  await expect(panel).toContainText('Audit Evidence Office');
  await expect(page.getByRole('button', { name: 'Close audit event detail' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('detail.png'), fullPage: true });

  await page.setViewportSize({ width: 800, height: 900 });
  const narrowPanel = page.getByRole('dialog', { name: 'Audit Event detail' });
  const panelBox = await narrowPanel.boundingBox();
  expect(panelBox).not.toBeNull();
  if (!panelBox) throw new Error('The narrow Audit Event panel geometry was unavailable.');
  expect(panelBox.width).toBeGreaterThan(760);
  await page.keyboard.press('Tab');
  await expect(narrowPanel.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(narrowPanel).toBeHidden();
  await expect(event).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('narrow.png'), fullPage: true });
});
