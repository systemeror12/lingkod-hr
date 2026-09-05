import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Personnel Action dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
  expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
}

test('opens Personnel Action preparation with the shared modal contract', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/personnel-actions');
  await expect(page.getByRole('heading', { name: 'Personnel actions', exact: true })).toBeVisible();

  const trigger = page.getByRole('button', { name: 'Prepare action' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Prepare Personnel Action' });
  await expect(dialog).toHaveAccessibleDescription(
    'Record the Employee, proposed effectivity, exact evidence versions, and action-specific facts.',
  );
  await expect(dialog.getByLabel('Employee')).toBeFocused();
  await expectCenteredDialog(dialog, 1280);
  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectCenteredDialog(dialog, 390);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(trigger).toBeFocused();
});
