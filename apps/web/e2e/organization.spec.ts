import { expect, test } from '@playwright/test';

test('creates and highlights a Draft Organization Unit through the Work queue', async ({
  page,
}, testInfo) => {
  const code = `RMD-${Date.now()}`;

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/organization');
  await expect(page.getByRole('heading', { name: 'Organization Units' })).toBeVisible();
  await expect(page.getByText('No Organization Units yet.', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('empty.png'), fullPage: true });

  const trigger = page.getByRole('button', { name: 'Create Organization Unit' });
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Create Organization Unit' });
  await expect(panel).toBeVisible();
  await expect(page.getByLabel('Official name')).toBeFocused();

  await page.getByRole('button', { name: 'Create Draft' }).click();
  await expect(page.getByText('Enter the official name.', { exact: true })).toBeVisible();
  await expect(panel).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('validation.png'), fullPage: true });

  await page.getByLabel('Official name').fill('Records Management Division');
  await page.getByLabel('Agency-unique code').fill(code);
  await page.getByLabel('Unit type').selectOption('DIVISION');
  await page.getByLabel('Effective date').fill('2026-08-15');
  await page.getByRole('button', { name: 'Create Draft' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Draft Organization Unit “Records Management Division” was created.',
  );
  const highlighted = page
    .getByRole('row')
    .filter({ hasText: 'Records Management Division' })
    .filter({ hasText: code });
  await expect(highlighted).toContainText('Records Management Division');
  await expect(highlighted).toContainText(code);
  await expect(highlighted).toContainText('DRAFT');
  await expect(highlighted).toHaveAttribute('data-highlighted', 'true');
  await expect(page.getByRole('button', { name: 'Create Organization Unit' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('success-highlight.png'), fullPage: true });

  await trigger.click();
  await page.getByLabel('Official name').fill('Replacement Records Management Division');
  await page.getByLabel('Agency-unique code').fill(code);
  await page.getByRole('button', { name: 'Create Draft' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
  await expect(page.getByLabel('Official name')).toHaveValue(
    'Replacement Records Management Division',
  );
  await expect(page.getByLabel('Agency-unique code')).toHaveValue(code);
  await panel.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 820, height: 900 });
  await trigger.click();
  await expect(panel).toBeVisible();
  const contextualPanelBox = await panel.boundingBox();
  expect(contextualPanelBox?.width).toBeLessThan(600);
  await panel.press('Escape');

  await page.setViewportSize({ width: 720, height: 900 });
  await trigger.click();
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  expect(panelBox?.width).toBeGreaterThan(680);
  await expect(page.getByLabel('Official name')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('responsive-panel.png'), fullPage: true });
});
