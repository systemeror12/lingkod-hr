import { expect, test, type Locator } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

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

async function selectOptionByText(scope: Locator, label: string, text: string): Promise<void> {
  const select = scope.getByLabel(label);
  const option = select.locator('option', { hasText: text });
  await expect(option).toHaveCount(1);
  const value = await option.getAttribute('value');
  await select.selectOption(value ?? '');
}

test('maintains a Work Schedule through the shared modal contract and activates it', async ({
  page,
}) => {
  const code = 'WS-E2E-' + Date.now();

  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/attendance-configuration');
  await expect(page.getByRole('heading', { name: 'Attendance Configuration' })).toBeVisible();
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

  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/attendance-configuration');
  await expect(page.getByRole('heading', { name: 'Attendance Configuration' })).toBeVisible();
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
  await dialog.getByLabel('Holiday Calendar').selectOption({
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

test('maintains a Holiday Calendar and resolves Schedule Assignments', async ({ page }) => {
  const code = 'HC-E2E-' + Date.now();

  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/attendance-configuration');
  await expect(page.getByRole('heading', { name: 'Attendance Configuration' })).toBeVisible();

  await page.getByRole('tab', { name: 'Holiday Calendars' }).click();
  await expect(page.getByRole('tab', { name: 'Holiday Calendars' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const calendarRegister = page.getByRole('region', { name: 'Holiday Calendar register' });
  await expect(calendarRegister).toContainText('PH-NATIONAL');

  const calendarTrigger = page.getByRole('button', { name: 'Create Holiday Calendar' });
  await calendarTrigger.click();
  const calendarDialog = page.getByRole('region', { name: 'Create Holiday Calendar' });
  await expect(calendarDialog).toBeVisible();
  await expect(calendarDialog).toHaveAccessibleDescription(
    'Declare the calendar scope, effective date, and one row per holiday date and day type.',
  );
  await expect(page.getByLabel('Holiday Calendar code')).toBeFocused();
  await expectWithinViewport(calendarDialog, page.viewportSize()?.width ?? 1280);

  await page.getByLabel('Holiday Calendar code').fill(code);
  await page.getByLabel('Holiday Calendar name').fill('E2E Agency Holidays');
  await page.getByLabel('Scope reference').fill('E2E-WORK-QUEUE');
  await page.getByLabel('Holiday name 1').fill('E2E Foundation Day');
  await page.getByLabel('Holiday source 1').fill('E2E Proclamation Fixture');
  await page.getByRole('button', { name: 'Create Draft' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Draft Holiday Calendar “' + code + '” was created.',
  );
  const calendarRow = calendarRegister.getByRole('row').filter({ hasText: code });
  await expect(calendarRow).toContainText('Agency · E2E-WORK-QUEUE');
  await expect(calendarRow).toContainText('No active version');
  await expect(calendarRow).toContainText('v1');
  await expect(calendarTrigger).toBeFocused();

  await calendarRow.getByRole('button', { name: 'Activate' }).click();
  const activateDialog = page.getByRole('dialog', { name: 'Activate ' + code });
  await expect(activateDialog).toBeVisible();
  await selectEvidence(page, 'E2E-HOLIDAY-CALENDAR-AUTHORITY');
  await page.getByLabel('Approving authority').fill('Office of the President');
  await page.getByLabel('Activation reason').fill('Calendar adopted for E2E coverage.');
  await page.getByRole('button', { name: 'Activate Version' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Holiday Calendar “' + code + '” was activated.',
  );
  await expect(calendarRow).toContainText('1 entry');

  await calendarRow.getByRole('button', { name: code }).click();
  const calendarDetail = page.getByRole('region', { name: 'Holiday Calendar · ' + code });
  await expect(calendarDetail).toContainText('E2E Foundation Day');
  await expect(calendarDetail).toContainText('Regular Holiday');
  await calendarDetail.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(calendarRow.getByRole('button', { name: code })).toBeFocused();

  await page.getByRole('tab', { name: 'Schedule Assignments' }).click();
  await expect(page.getByRole('tab', { name: 'Schedule Assignments' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const assignmentRegister = page.getByRole('region', { name: 'Schedule Assignment register' });
  const seededRow = assignmentRegister.getByRole('row').filter({ hasText: 'E2E-0001' });
  await expect(seededRow).toContainText('ORDINARY v1');
  await expect(seededRow).toContainText('ONSITE v1');
  await expect(seededRow).toContainText('open-ended');

  const start = new Date(Date.now() + 20_000 * 86_400_000).toISOString().slice(0, 10);
  const assignmentTrigger = page.getByRole('button', { name: 'Create Schedule Assignment' });
  await assignmentTrigger.click();
  const assignmentDialog = page.getByRole('region', { name: 'Create Schedule Assignment' });
  await expect(assignmentDialog).toBeVisible();
  await expect(assignmentDialog).toHaveAccessibleDescription(
    'Bind one Employee to an active Work Schedule Version and Work Arrangement Version for a non-overlapping period, with the authority Document Version.',
  );
  await selectOptionByText(assignmentDialog, 'Employee', 'E2E-MOVE-001');
  await selectOptionByText(assignmentDialog, 'Work Schedule Version', 'ORDINARY · v1');
  await selectOptionByText(assignmentDialog, 'Work Arrangement Version', 'ONSITE · v1');
  await assignmentDialog.getByLabel('Effective from').fill(start);
  await selectEvidence(page, 'E2E-SCHEDULE-ASSIGNMENT-AUTHORITY');
  await page.getByRole('button', { name: 'Create Assignment' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Schedule Assignment for E2E-MOVE-001 · E2E Movement Candidate was created.',
  );
  const openRow = assignmentRegister
    .getByRole('row')
    .filter({ hasText: 'E2E-MOVE-001' })
    .filter({ hasText: 'open-ended' });
  await expect(openRow).toHaveCount(1);

  await openRow.getByRole('button', { name: 'End' }).click();
  const endDialog = page.getByRole('region', {
    name: 'End Schedule Assignment · E2E Movement Candidate',
  });
  await expect(endDialog).toBeVisible();
  await endDialog.getByLabel('Effective to').fill(start);
  await endDialog.getByLabel('End reason').fill('E2E coverage completed.');
  await endDialog.getByRole('button', { name: 'End Assignment' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Schedule Assignment for E2E-MOVE-001 ended on',
  );
  await expect(openRow).toHaveCount(0);

  const resolutionPanel = page.getByRole('region', { name: 'Work date resolution' });
  await selectOptionByText(resolutionPanel, 'Employee', 'E2E-0001');
  await resolutionPanel.getByLabel('Work date').fill('2026-01-01');
  await resolutionPanel.getByRole('button', { name: 'Resolve Work date' }).click();
  await expect(resolutionPanel).toContainText('ORDINARY v1');
  await expect(resolutionPanel).toContainText('ONSITE v1');
  await expect(resolutionPanel).toContainText("New Year's Day (Regular Holiday)");
  await expect(resolutionPanel).toContainText('Thursday · Fixed · 08:00–17:00');

  await resolutionPanel.getByLabel('Work date').fill('2026-01-03');
  await resolutionPanel.getByRole('button', { name: 'Resolve Work date' }).click();
  await expect(resolutionPanel).toContainText('Saturday · Rest · No duty');
  await expect(resolutionPanel).toContainText('No holiday entry on this date');

  await selectOptionByText(resolutionPanel, 'Employee', 'E2E-MOVE-001');
  await resolutionPanel.getByRole('button', { name: 'Resolve Work date' }).click();
  await expect(resolutionPanel).toContainText(
    'No Schedule Assignment is effective on the Work Date.',
  );
  await expect(resolutionPanel).toContainText('Cause: Missing Schedule Assignment');
});
