import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Plantilla Position dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
  expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
}

test('creates a proposed Plantilla Position and prepares one successor', async ({ page }) => {
  const itemNumber = 'E2E-' + Date.now();

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/plantilla-positions');
  await expect(
    page.getByRole('heading', { name: 'Plantilla positions', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /HRM-000142/ })).toBeVisible();

  const trigger = page.getByRole('button', { name: 'Create proposed position' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create proposed position' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    'Reserve the permanent Item Number and record its first effective definition against active Agency references.',
  );
  await expect(dialog.getByLabel('Permanent Item Number')).toBeFocused();
  await expectCenteredDialog(dialog, page.viewportSize()?.width ?? 1280);

  await page.mouse.click(1, 1);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await dialog.getByLabel('Permanent Item Number').fill(itemNumber);
  await dialog.getByLabel('Position title').fill('Human Resource Management Officer III');
  await dialog.getByLabel('Parenthetical title Optional').fill('Records and Staffing');
  await dialog.getByLabel('Salary grade').fill('18');
  await dialog.getByLabel('Organization unit').selectOption({ index: 1 });
  await dialog.getByLabel('Funding source').fill('General Appropriations Act');
  await dialog.getByLabel('Exact Qualification Standard version').selectOption({ index: 1 });
  await dialog.getByLabel('Applicable Staffing Authority').selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Create proposed position' }).click();

  await expect(page.getByRole('status')).toContainText(
    `Proposed position “${itemNumber}” was created.`,
  );
  const result = page.getByRole('button', { name: new RegExp(itemNumber) });
  await expect(result).toBeVisible();
  await result.click();
  await expect(
    page.getByRole('heading', { name: 'Human Resource Management Officer III' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Effective definition' }).getByText('Version 1', {
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Prepare successor' }).click();
  await expect(page.getByRole('status')).toContainText(
    `Draft successor prepared for “${itemNumber}”.`,
  );
  await expect(page.getByRole('button', { name: 'Draft successor exists' })).toBeDisabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expectCenteredDialog(dialog, 390);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
