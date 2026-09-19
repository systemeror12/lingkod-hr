import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type APIResponse } from '@playwright/test';

function resetFixture(): void {
  execFileSync('pnpm', ['--filter', '@lingkod-hr/database', 'e2e:seed:shell'], {
    cwd: resolve(__dirname, '../../..'),
    env: { ...process.env },
    stdio: 'pipe',
  });
}

async function apiBody<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

function recentWeekday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

function weekdayName(dateValue: string): string {
  return new Date(dateValue + 'T00:00:00.000Z').toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

test('enables the Web clock, records a manual Attendance Event, and inspects the Work Date', async ({
  page,
}) => {
  test.setTimeout(120_000);
  resetFixture();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();

  const headers = { origin: new URL(page.url()).origin };
  const session = await apiBody<{ agencyId: string }>(
    await page.request.get('/api/v1/auth/me', { headers }),
  );
  const agencyBase = `/api/v1/agencies/${session.agencyId}`;
  const employees = await apiBody<{
    employees: Array<{ id: string; employeeNumber: string; legalName: string }>;
  }>(await page.request.get(`${agencyBase}/employees`, { headers }));
  const employee = employees.employees.find(({ employeeNumber }) => employeeNumber === 'E2E-0001');
  if (!employee) throw new Error('The E2E-0001 Employee fixture is missing.');
  const workDate = recentWeekday();

  await page.goto('/attendance');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Attendance', exact: true }),
  ).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await expect(navigation.getByRole('link', { name: 'Attendance', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const webClock = page.getByRole('region', { name: 'Web clock enablement' });
  await expect(webClock).toContainText('Disabled by default');
  await webClock.getByRole('button', { name: 'Enable Web clock', exact: true }).click();
  const enableDialog = page.getByRole('region', { name: 'Enable Web Clock', exact: true });
  await expect(enableDialog).toBeVisible();
  await expect(enableDialog.getByLabel('Effective from')).toHaveValue(/\d{4}-\d{2}-\d{2}/);
  await enableDialog.getByLabel('Reason').fill('E2E web clock enablement.');
  await enableDialog.getByRole('button', { name: 'Enable Web Clock', exact: true }).click();
  await expect(page.getByRole('status').first()).toContainText('The Agency Web clock was enabled');
  await expect(webClock).toContainText('Enabled');
  await expect(webClock).toContainText('v1');

  const clock = page.getByRole('region', { name: 'My Web clock' });
  await expect(clock).toContainText('not linked to an Employee');

  const manual = page.getByRole('region', { name: 'Record manual Attendance Event' });
  await manual.getByLabel('Employee').selectOption(employee.id);
  await manual.getByLabel('Event type').selectOption('TIME_IN');
  await manual.getByLabel('Event date').fill(workDate);
  await manual.getByLabel('Event time').fill('08:00');
  await manual.getByLabel('Reason').fill('E2E manual time-in for the morning shift.');
  await manual.getByRole('button', { name: 'Record Event' }).click();
  await expect(manual).toContainText('Matched');
  await expect(manual).toContainText('AM In');
  await expect(manual).toContainText('ORDINARY v1');
  await expect(manual).toContainText('No blocking Attendance Exceptions.');

  const register = page.getByRole('region', { name: 'Attendance Event register' });
  const row = register.getByRole('row').filter({ hasText: 'E2E-0001' });
  await expect(row).toContainText('Time in');
  await expect(row).toContainText('Manual');
  await expect(row).toContainText('E2E manual time-in for the morning shift.');

  const contextPanel = page.getByRole('region', { name: 'Work date context' });
  await contextPanel.getByLabel('Employee').selectOption(employee.id);
  await contextPanel.getByLabel('Work date').fill(workDate);
  await contextPanel.getByRole('button', { name: 'Inspect Work Date' }).click();
  await expect(contextPanel).toContainText('ORDINARY v1');
  await expect(contextPanel).toContainText('AM In');
  await expect(contextPanel).toContainText(`${weekdayName(workDate)} · Fixed · 08:00–17:00`);

  await webClock.getByRole('button', { name: 'Disable Web clock', exact: true }).click();
  const disableDialog = page.getByRole('region', { name: 'Disable Web Clock', exact: true });
  await expect(disableDialog).toBeVisible();
  await disableDialog.getByLabel('Reason').fill('E2E web clock disablement.');
  await disableDialog.getByRole('button', { name: 'Disable Web Clock', exact: true }).click();
  await expect(page.getByRole('status').first()).toContainText('The Agency Web clock was disabled');
  await expect(webClock).toContainText('v2');
  await expect(webClock.getByRole('row').filter({ hasText: 'v2' })).toContainText('Disabled');
});
