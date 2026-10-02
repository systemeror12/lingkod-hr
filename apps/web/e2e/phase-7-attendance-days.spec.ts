import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

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

test('calculates an Attendance Day from captured events and inspects its record', async ({
  page,
}) => {
  test.setTimeout(120_000);
  resetFixture();
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, MARISOL_EMAIL);
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
    await manual.getByLabel('Reason').fill(`E2E ${eventType} for the Attendance Day spec.`);
    await manual.getByRole('button', { name: 'Record Event' }).click();
    await expect(manual).toContainText('Matched');
  }

  await page.goto('/attendance-days');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Attendance Days', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('No Attendance Days yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Calculate attendance days', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Calculate Attendance Days', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Period code').fill('E2E-2026-01');
  await page.getByLabel('From', { exact: true }).fill(workDate);
  await page.getByLabel('To', { exact: true }).fill(workDate);
  await page
    .getByLabel('Employees', { exact: true })
    .selectOption({ label: 'Alex Rivera · E2E-0001' });
  await page.getByRole('button', { name: 'Calculate', exact: true }).click();

  await expect(page.getByRole('status')).toContainText('1 created');
  const record = page.getByRole('region', { name: 'Attendance Day record' });
  await expect(record).toBeVisible();
  await expect(record).toContainText('Alex Rivera');
  await expect(record).toContainText('Calculated');
  await expect(record).toContainText('Expected');
  await expect(record).toContainText('8h');
  await expect(record).toContainText('No exceptions were recorded for this version.');

  await page.getByRole('button', { name: 'Tree', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'E2E-0001' });
  await expect(row).toContainText('Calculated');
  await expect(row).toContainText('v1');

  await page.getByRole('combobox', { name: 'Status' }).selectOption('EXCEPTION');
  await expect(page.getByText('No days match.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('CALCULATED');
  await expect(row).toBeVisible();
});
