import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Organization Unit dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
  expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
}

async function expectFocusInside(dialog: Locator): Promise<void> {
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

test('creates and highlights a Draft Organization Unit through the Work queue', async ({
  page,
}, testInfo) => {
  const code = `RMD-${Date.now()}`;

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/organization');
  await expect(page.getByRole('heading', { name: 'Organization Units' })).toBeVisible();
  const emptyState = page.getByText('No Organization Units yet.', { exact: true });
  if (await emptyState.count()) {
    await expect(emptyState).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('empty.png'), fullPage: true });
  }

  const trigger = page.getByRole('button', { name: 'Create Organization Unit' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create Organization Unit' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    'Register the unit now. Hierarchy and activation come later.',
  );
  await expect(page.getByLabel('Official name')).toBeFocused();
  await expectCenteredDialog(dialog, page.viewportSize()?.width ?? 1280);
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();

  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    await expectFocusInside(dialog);
  }
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Shift+Tab');
    await expectFocusInside(dialog);
  }

  await page.getByRole('button', { name: 'Create Draft' }).click();
  await expect(page.getByText('Enter the official name.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Official name')).toBeFocused();
  await expect(dialog).toBeVisible();
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
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 820, height: 900 });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expectCenteredDialog(dialog, 820);
  await dialog.press('Escape');

  await page.setViewportSize({ width: 720, height: 900 });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expectCenteredDialog(dialog, 720);
  await expect(page.getByLabel('Official name')).toBeFocused();
  await dialog.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expectCenteredDialog(dialog, 390);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Draft' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('responsive-modal.png'), fullPage: true });
});

test('guards every Organization Unit dismissal path during submission', async ({ page }) => {
  let releaseResponse!: () => void;
  const responseReleased = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await page.route('**/api/v1/agencies/*/organization-units', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await responseReleased;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'held-organization-unit',
        code: 'HELD',
        officialName: 'Held Organization Unit',
        unitType: 'OFFICE',
        effectiveDate: '2026-08-16',
        status: 'DRAFT',
      }),
    });
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/organization');
  const trigger = page.getByRole('button', { name: 'Create Organization Unit' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create Organization Unit' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Official name').fill('Held Organization Unit');
  await page.getByLabel('Agency-unique code').fill('HELD');
  await page.getByRole('button', { name: 'Create Draft' }).click();

  const createButton = page.getByRole('button', { name: /Create Draft|Creating…/ });
  await expect(createButton).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Close Organization Unit dialog' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();

  releaseResponse();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
