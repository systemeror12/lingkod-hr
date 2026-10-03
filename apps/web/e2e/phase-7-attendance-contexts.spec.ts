import { expect, test } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

test('records an Attendance Context and reads it across Tree, Form, and Kanban', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();

  await page.goto('/attendance-contexts');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Attendance Contexts', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tree', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const reason = 'Field validation with the municipal treasurer — E2E ' + Date.now();
  await page.getByRole('button', { name: 'Record attendance context', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Record Attendance Context', exact: true }),
  ).toBeVisible();

  await page.getByLabel('Employee').selectOption({ label: 'E2E-0001 · Alex Rivera' });
  await expect(page.getByRole('radio', { name: 'Whole work date' })).toBeChecked();
  await page.getByRole('textbox', { name: 'Work date' }).fill('2026-09-08');
  await page.getByLabel('Reason').fill(reason);
  await page.getByLabel('Source type (link one authoritative record)').fill('TravelOrder');
  await page.getByLabel('Source identifier').fill('11111111-1111-4111-8111-111111111111');
  await page.getByRole('button', { name: 'Record Attendance Context', exact: true }).click();

  await expect(page.getByRole('status')).toContainText('Attendance Context recorded');
  await expect(page).toHaveURL(/view=form/);
  await expect(page.getByText(reason)).toBeVisible();
  await expect(page.getByText('TravelOrder · 11111111-1111-4111-8111-111111111111')).toBeVisible();
  await expect(page.getByText('Alex Rivera · E2E-0001')).toBeVisible();

  const timedReason = 'Court hearing attendance — E2E ' + Date.now();
  await page.getByRole('button', { name: 'Record attendance context', exact: true }).click();
  await page.getByLabel('Employee').selectOption({ label: 'E2E-0001 · Alex Rivera' });
  await page.getByLabel('Context type').selectOption('OFFICIAL_TRAVEL');
  await page.getByRole('radio', { name: 'Exact time range' }).check();
  await page.getByLabel('Starts (Manila time)').fill('2026-09-09T09:00');
  await page.getByLabel('Ends (Manila time)').fill('2026-09-09T11:30');
  await page.getByLabel('Reason').fill(timedReason);
  await page.getByLabel('Source type (link one authoritative record)').fill('TravelOrder');
  await page.getByLabel('Source identifier').fill('22222222-2222-4222-8222-222222222222');
  await page.getByRole('button', { name: 'Record Attendance Context', exact: true }).click();

  await expect(page.getByRole('status')).toContainText('Attendance Context recorded');
  await expect(page.getByText(timedReason)).toBeVisible();

  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(page.getByRole('button', { name: /Alex Rivera/ })).toHaveCount(2);

  await page.getByRole('button', { name: 'Tree', exact: true }).click();
  const timedRow = page.getByRole('row').filter({ hasText: timedReason });
  await expect(timedRow).toContainText('Exact time range');
  await expect(timedRow).toContainText('Official travel');
  const row = page.getByRole('row').filter({ hasText: reason });
  await expect(row).toContainText('Alex Rivera');
  await expect(row).toContainText('E2E-0001');

  await page.getByRole('combobox', { name: 'Context' }).selectOption('TRAINING');
  await expect(page.getByText('No contexts match.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Context' }).selectOption('ALL');
  await expect(row).toBeVisible();
});
