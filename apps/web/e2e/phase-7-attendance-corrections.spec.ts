import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

function resetFixture(): void {
  execFileSync('pnpm', ['--filter', '@lingkod-hr/database', 'e2e:seed:shell'], {
    cwd: resolve(__dirname, '../../..'),
    env: { ...process.env },
    stdio: 'pipe',
  });
}

function recentWeekday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

test('creates, submits, and guards an Attendance Correction through the protected workspace', async ({
  page,
}) => {
  test.setTimeout(180_000);
  resetFixture();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();

  const workDate = recentWeekday();

  await page.goto('/attendance');
  const manual = page.getByRole('region', { name: 'Record manual Attendance Event' });
  for (const [eventType, time] of [
    ['TIME_IN', '08:00'],
    ['TIME_OUT', '17:00'],
  ] as const) {
    await manual.getByLabel('Employee').selectOption({ label: 'E2E-0001 · Alex Rivera' });
    await manual.getByLabel('Event type').selectOption(eventType);
    await manual.getByLabel('Event date').fill(workDate);
    await manual.getByLabel('Event time').fill(time);
    await manual.getByLabel('Reason').fill(`E2E ${eventType} for the Attendance Correction spec.`);
    await manual.getByRole('button', { name: 'Record Event' }).click();
    await expect(manual).toContainText('Matched');
  }

  await page.goto('/attendance-days');
  await page.getByRole('button', { name: 'Calculate attendance days', exact: true }).click();
  await page.getByLabel('Period code').fill('E2E-CORRECTION-2026-01');
  await page.getByLabel('From', { exact: true }).fill(workDate);
  await page.getByLabel('To', { exact: true }).fill(workDate);
  await page
    .getByLabel('Employees', { exact: true })
    .selectOption({ label: 'Alex Rivera · E2E-0001' });
  await page.getByRole('button', { name: 'Calculate', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('1 created');

  await page.goto('/attendance-corrections');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Attendance Corrections' }),
  ).toBeVisible();
  await expect(page.getByText('No Attendance Corrections match.')).toBeVisible();

  await page.getByRole('button', { name: 'New correction' }).click();
  await page
    .getByLabel('Employee (leave blank for your own record)')
    .selectOption({ label: 'Alex Rivera (E2E-0001)' });
  await page.getByLabel('Target type').selectOption('ATTENDANCE_EVENT');
  await page.getByLabel('Requested action').selectOption('ADD');
  await page.getByLabel('Proposed event type').selectOption('BREAK_OUT');
  await page.getByLabel('Proposed event instant').fill(`${workDate}T12:00`);
  await page
    .getByLabel('Reason', { exact: true })
    .fill('The Employee rendered duty but no break event was captured.');
  await page
    .getByLabel('On-behalf reason')
    .fill('Recorded on behalf after the signed logbook check.');
  await page.getByLabel('Evidence source type').fill('E2E_LOG_BOOK');
  await page.getByLabel('Evidence source identifier').fill('00000000-0000-4000-8000-000000000501');
  await page.getByRole('button', { name: 'Save draft' }).click();

  const detail = page.getByRole('region', { name: 'Attendance Correction record' });
  await expect(page.getByRole('heading', { level: 2, name: 'Add attendance event' })).toBeVisible();
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
  await expect(page.getByText('locked predecessor present')).toHaveCount(0);

  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('SUBMITTED', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Tree', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'Alex Rivera' });
  await expect(row).toContainText('SUBMITTED');
  await expect(row).toContainText('Add');

  await row.getByRole('button', { name: 'Alex Rivera' }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(
    page.getByText('The initiator or recorder cannot decide the same Attendance Correction.'),
  ).toBeVisible();

  await page.getByLabel('Decision comments').fill('Withdrawn after the logbook review.');
  await page.getByRole('button', { name: 'Cancel correction' }).click();
  await expect(page.getByText('CANCELLED', { exact: true })).toBeVisible();
  await expect(detail).toBeVisible();
});

test('shows the Attendance Corrections destination in navigation', async ({ page }) => {
  test.setTimeout(120_000);
  resetFixture();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await navigation.getByRole('button', { name: 'Time & attendance' }).click();
  await expect(
    navigation.getByRole('link', { name: 'Attendance Corrections', exact: true }),
  ).toBeVisible();
  await page.goto('/attendance-corrections');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Attendance Corrections' }),
  ).toBeVisible();
});
