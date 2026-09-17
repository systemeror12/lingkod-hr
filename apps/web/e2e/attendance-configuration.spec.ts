import { expect, test, type Locator } from '@playwright/test';

async function expectWithinViewport(dialog: Locator, viewportWidth: number): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('The Attendance Configuration dialog geometry was unavailable.');
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth - 16);
}

function weekdaySection(dialog: Locator, weekday: string): Locator {
  return dialog.getByRole('region', { name: weekday, exact: true });
}

async function selectEvidence(page: import('@playwright/test').Page, documentNo: string) {
  const select = page.getByLabel('Authority Document Version');
  const option = select.locator('option', { hasText: documentNo });
  await expect(option).toHaveCount(1);
  const value = await option.getAttribute('value');
  await select.selectOption(value ?? '');
}

test('maintains a Work Schedule through the shared modal contract and activates it', async ({
  page,
}) => {
  const code = 'WS-E2E-' + Date.now();

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/attendance-configuration');
  await expect(page.getByRole('heading', { name: 'Work Schedules & Arrangements' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Work Schedules' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const trigger = page.getByRole('button', { name: 'Create Work Schedule' });
  await trigger.click();
  const dialog = page.getByRole('region', { name: 'Create Work Schedule' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    'Declare the schedule type, time zone, effective date, and exactly one Day Rule per weekday. Required minutes exclude unpaid breaks.',
  );
  await expect(page.getByLabel('Work Schedule code')).toBeFocused();
  await expectWithinViewport(dialog, page.viewportSize()?.width ?? 1280);

  const monday = weekdaySection(dialog, 'Monday');
  const saturday = weekdaySection(dialog, 'Saturday');
  const sunday = weekdaySection(dialog, 'Sunday');
  await expect(monday.getByLabel('Duty start', { exact: true })).toHaveValue('08:00');
  await expect(monday.getByLabel('Duty end', { exact: true })).toHaveValue('17:00');
  await expect(monday.getByLabel('Required minutes', { exact: true })).toHaveValue('480');
  await expect(monday.getByLabel('Monday break start 1')).toHaveValue('12:00');
  await expect(monday.getByLabel('Monday break end 1')).toHaveValue('13:00');
  await expect(saturday.getByLabel('Day rule')).toHaveValue('REST');
  await expect(sunday.getByLabel('Day rule')).toHaveValue('REST');
  await expect(dialog.getByRole('heading', { name: 'Monday' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Sunday' })).toBeVisible();

  await page.getByLabel('Work Schedule code').fill(code);
  await page.getByLabel('Work Schedule name').fill('E2E Ordinary Work Schedule');
  await page.getByRole('button', { name: 'Create Draft' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Draft Work Schedule “' + code + '” was created.',
  );
  const row = page.getByRole('row').filter({ hasText: code });
  await expect(row).toContainText('No active version');
  await expect(row).toContainText('v1');
  await expect(row).toContainText('Asia/Manila');
  await expect(trigger).toBeFocused();

  await row.getByRole('button', { name: 'Edit Draft' }).click();
  const editDialog = page.getByRole('region', { name: 'Edit Draft Work Schedule' });
  await expect(editDialog).toBeVisible();
  await expect(page.getByLabel('Work Schedule code')).toHaveCount(0);
  await expect(page.getByLabel('Effective date')).toHaveValue(/\d{4}-\d{2}-\d{2}/);
  await expectWithinViewport(editDialog, page.viewportSize()?.width ?? 1280);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(editDialog).toBeHidden();

  await row.getByRole('button', { name: code }).click();
  const detailDialog = page.getByRole('region', { name: 'Work Schedule · ' + code });
  await expect(detailDialog).toContainText('Version 1');
  await expect(detailDialog).toContainText('Monday');
  await expect(detailDialog).toContainText('Fixed');
  await expect(detailDialog).toContainText('480 min');
  await expect(detailDialog).toContainText('12:00–13:00');
  await expect(detailDialog).toContainText('Rest');
  await detailDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(row.getByRole('button', { name: code })).toBeFocused();

  await row.getByRole('button', { name: 'Activate' }).click();
  const activateDialog = page.getByRole('dialog', { name: 'Activate ' + code });
  await expect(activateDialog).toBeVisible();
  await selectEvidence(page, 'E2E-ORDINARY-SCHEDULE-AUTHORITY');
  await page.getByLabel('Approving authority').fill('Office of the President');
  await page.getByLabel('Activation reason').fill('Ordinary schedule adopted for E2E coverage.');
  await page.getByRole('button', { name: 'Activate Version' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Work Schedule “' + code + '” was activated.',
  );
  await expect(row).toContainText('Regular');
  await expect(row).not.toContainText('No active version');

  await row.getByRole('button', { name: 'Create Successor' }).click();
  const successorDialog = page.getByRole('dialog', { name: 'Create Successor · ' + code });
  await expect(successorDialog).toBeVisible();
  await successorDialog.getByRole('button', { name: 'Create Successor' }).click();
  await expect(page.getByRole('status')).toContainText(
    'A Draft successor for “' + code + '” was created.',
  );
  await expect(row).toContainText('v2');
});

test('maintains a Work Arrangement pinned to a Holiday Calendar', async ({ page }) => {
  const code = 'WA-E2E-' + Date.now();

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/attendance-configuration');
  await expect(page.getByRole('heading', { name: 'Work Schedules & Arrangements' })).toBeVisible();
  await page.getByRole('tab', { name: 'Work Arrangements' }).click();
  await expect(page.getByRole('tab', { name: 'Work Arrangements' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const trigger = page.getByRole('button', { name: 'Create Work Arrangement' });
  await trigger.click();
  const dialog = page.getByRole('region', { name: 'Create Work Arrangement' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    'Declare the operating mode, its permitted schedule types, the pinned Holiday Calendar, and the effective date.',
  );
  await expect(page.getByLabel('Work Arrangement code')).toBeFocused();

  await page.getByLabel('Work Arrangement code').fill(code);
  await page.getByLabel('Work Arrangement name').fill('E2E Hybrid Work Arrangement');
  await page.getByLabel('Arrangement type').selectOption('HYBRID');
  await page.getByLabel('Holiday Calendar').selectOption({
    label: 'PH-NATIONAL · Philippine National Holidays',
  });
  await page.getByLabel('Flexible', { exact: true }).check();
  await page.getByRole('button', { name: 'Create Draft' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Draft Work Arrangement “' + code + '” was created.',
  );
  const row = page.getByRole('row').filter({ hasText: code });
  await expect(row).toContainText('No active version');
  await expect(row).toContainText('v1');
  await expect(trigger).toBeFocused();

  await row.getByRole('button', { name: 'Activate' }).click();
  const activateDialog = page.getByRole('dialog', { name: 'Activate ' + code });
  await expect(activateDialog).toBeVisible();
  await selectEvidence(page, 'E2E-ORDINARY-SCHEDULE-AUTHORITY');
  await page.getByLabel('Approving authority').fill('Office of the President');
  await page.getByLabel('Activation reason').fill('Hybrid arrangement adopted for E2E coverage.');
  await page.getByRole('button', { name: 'Activate Version' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Work Arrangement “' + code + '” was activated.',
  );
  await expect(row).toContainText('Hybrid');
  await expect(row).toContainText('Regular, Flexible');

  await row.getByRole('button', { name: code }).click();
  const detailDialog = page.getByRole('region', { name: 'Work Arrangement · ' + code });
  await expect(detailDialog).toContainText('Version 1');
  await expect(detailDialog).toContainText('PH-NATIONAL');
  await expect(detailDialog).toContainText('Office of the President');
  await detailDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(row.getByRole('button', { name: code })).toBeFocused();
});
