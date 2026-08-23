import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Staffing Authority dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
  expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
}

async function expectFocusInside(dialog: Locator): Promise<void> {
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

test('registers a Draft Staffing Authority through the shared modal contract', async ({ page }) => {
  const reference = 'LAW-E2E-80-001';

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/staffing-authorities');
  await expect(
    page.getByRole('heading', { name: 'Staffing Authorities', exact: true }),
  ).toBeVisible();

  const trigger = page.getByRole('button', { name: 'Register Staffing Authority' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Register Staffing Authority' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    'Record official metadata first. The record remains Draft until External Evidence is linked and validated.',
  );
  await expect(page.getByLabel('Official reference')).toBeFocused();
  await expectCenteredDialog(dialog, page.viewportSize()?.width ?? 1280);
  const cancelButton = dialog.getByRole('button', { name: 'Cancel' });
  const createButton = dialog.getByRole('button', { name: 'Create Draft' });
  await expect(cancelButton).toHaveCSS('min-height', '44px');
  await expect(createButton).toHaveCSS('min-height', '44px');

  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    await expectFocusInside(dialog);
  }

  await createButton.click();
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Official reference')).toBeFocused();

  await page.getByLabel('Official reference').fill(reference);
  await page.getByLabel('Issue date').fill('2026-08-01');
  await page.getByLabel('Effective date').fill('2026-08-15');
  await page.getByLabel('Source issuer').fill('E2E source');
  await createButton.click();

  await expect(page.getByRole('status')).toContainText(
    `Draft Staffing Authority “${reference}” was created.`,
  );
  const row = page.getByRole('row').filter({ hasText: reference });
  await expect(row).toContainText('DRAFT');
  await expect(row).toContainText('Not linked');
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expectCenteredDialog(dialog, 390);
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();
  await expect(dialog).toBeHidden();
});
