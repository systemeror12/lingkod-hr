import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Personnel Baseline dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
}

test('opens the Personnel Baseline workflow with the shared modal contract', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/personnel-baselines');
  await expect(
    page.getByRole('heading', { name: 'Personnel Baselines', exact: true }),
  ).toBeVisible();

  const trigger = page.getByRole('button', { name: 'Prepare baseline' });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.getByRole('region', { name: 'Prepare Personnel Baseline' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    'Capture the approved authority evidence and effective-dated facts for an existing Employee.',
  );
  await expect(dialog.getByLabel('Employee')).toBeFocused();
  await expectCenteredDialog(dialog, page.viewportSize()?.width ?? 1280);

  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectCenteredDialog(dialog, 390);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
