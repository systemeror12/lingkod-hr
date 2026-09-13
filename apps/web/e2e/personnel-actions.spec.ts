import { expect, test, type Locator } from '@playwright/test';

async function expectCenteredDialog(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Personnel Action dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
}

test('opens Personnel Action preparation with the shared modal contract', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/personnel-actions');
  await expect(page.getByRole('heading', { name: 'Personnel actions', exact: true })).toBeVisible();

  const trigger = page.getByRole('button', { name: 'Prepare action' });
  await trigger.click();
  const dialog = page.getByRole('region', { name: 'Prepare Personnel Action' });
  await expect(dialog).toHaveAccessibleDescription(
    'Record the Employee, proposed effectivity, exact evidence versions, and action-specific facts.',
  );
  await expect(dialog.getByLabel('Employee')).toBeFocused();
  await expectCenteredDialog(dialog, 1280);
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
  await expect(trigger).toBeFocused();
});

test('confirms and shows an effective compensation action in shared modals', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/personnel-actions');
  await page.getByRole('button', { name: 'Open action for Alex Rivera' }).click();

  const detail = page.getByRole('region', { name: 'Alex Rivera' });
  await detail.getByRole('button', { name: 'Effectuate action' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Effectuate Personnel Action' });
  await expect(confirmation).toHaveAccessibleDescription(
    'Confirm the effective-dated compensation facts for exact version 1.',
  );
  await expect(confirmation.getByText('SG 24, Step 2')).toBeVisible();
  await confirmation.getByRole('button', { name: 'Confirm effectuation' }).click();

  await expect(detail.getByText('EFFECTIVE', { exact: true })).toBeVisible();
  await expect(detail.getByText('SG 24, Step 2')).toBeVisible();
  await detail.getByRole('button', { name: 'View history' }).click();
  const history = page.getByRole('region', { name: 'Personnel Action history' });
  await expect(history.getByText('PERSONNEL ACTION EFFECTUATED')).toBeVisible();
});

test('reviews, confirms, and reports service-status effectuation in shared modals', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await page.route('**/api/v1/agencies/*/personnel-actions/*/effectuate', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['idempotency-key']).toMatch(/^web-/);
    const response = await route.fetch({
      method: 'GET',
      url: route
        .request()
        .url()
        .replace(/\/effectuate$/, ''),
    });
    const action = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      contentType: 'application/json',
      json: { ...action, status: 'EFFECTIVE', effectuatedAt: new Date().toISOString() },
    });
  });

  await page.goto('/personnel-actions');
  await page.getByRole('button', { name: 'Open action for E2E Separation Candidate' }).click();
  const detail = page.getByRole('region', { name: 'E2E Separation Candidate' });
  await detail.getByRole('button', { name: 'Effectuate action' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Effectuate Personnel Action' });
  await expect(confirmation).toContainText('preserved service history');
  await confirmation.getByRole('button', { name: 'Confirm effectuation' }).click();
  await expect(detail.getByText('EFFECTIVE', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Close Personnel Action details' }).click();
  await expect(page.getByRole('status')).toHaveText('Personnel Action effectuated.');
});

test('effectuates an appointment-backed promotion into its reserved item', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/personnel-actions');
  await page.getByRole('button', { name: 'Open action for E2E Movement Candidate' }).click();

  const detail = page.getByRole('region', { name: 'E2E Movement Candidate' });
  await expect(detail.getByText('Assumed Appointment')).toBeVisible();
  await detail.getByRole('button', { name: 'Effectuate action' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Effectuate Personnel Action' });
  await expect(confirmation).toHaveAccessibleDescription(
    "Consume exact version 1's assumed Appointment to move the Employee into the reserved Plantilla item.",
  );
  await expect(confirmation).toContainText('closes the source Service Segment');
  await confirmation.getByRole('button', { name: 'Confirm effectuation' }).click();

  await expect(detail.getByText('EFFECTIVE', { exact: true })).toBeVisible();
  await expect(detail.getByText('Target Plantilla Position')).toBeVisible();
  await detail.getByRole('button', { name: 'View history' }).click();
  const history = page.getByRole('region', { name: 'Personnel Action history' });
  await expect(history.getByText('PERSONNEL ACTION EFFECTUATED')).toBeVisible();
});
