import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type APIResponse } from '@playwright/test';
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

async function apiBody<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
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

  // The review case of ADR 0005: sub-minute events count only Fully Covered Minutes. The
  // manual form records whole minutes, so the seconds go through the API.
  const headers = { origin: new URL(page.url()).origin };
  const session = await apiBody<{ agencyId: string }>(
    await page.request.get('/api/v1/auth/me', { headers }),
  );
  const agencyBase = `/api/v1/agencies/${session.agencyId}`;
  const employees = await apiBody<{ employees: Array<{ id: string; employeeNumber: string }> }>(
    await page.request.get(`${agencyBase}/employees`, { headers }),
  );
  const employee = employees.employees.find(({ employeeNumber }) => employeeNumber === 'E2E-0001');
  if (!employee) throw new Error('The E2E-0001 Employee fixture is missing.');
  for (const [eventType, timeValue] of [
    ['TIME_IN', '08:00:59'],
    ['TIME_OUT', '17:00:01'],
  ] as const) {
    await apiBody(
      await page.request.post(`${agencyBase}/attendance/events`, {
        headers,
        data: {
          employeeId: employee.id,
          eventType,
          eventTime: `${workDate}T${timeValue}+08:00`,
          reason: `E2E ${eventType} for the Attendance Day spec.`,
        },
      }),
    );
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
  const total = (label: string) =>
    record.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) });
  await expect(total('Expected')).toContainText('8h');
  await expect(total('Worked')).toContainText('7h 59m');
  await expect(total('Coverage')).toContainText('7h 59m');
  await expect(total('Late')).toContainText('1m');
  await expect(total('Undertime')).toContainText('0m');
  await expect(total('Absence')).toContainText('0m');
  const segments = record.getByRole('table', { name: 'Segments' }).locator('tbody tr');
  await expect(segments).toHaveCount(3);
  await expect(segments.nth(0)).toContainText(/8:00\s?AM – 8:01\s?AM.*Tardiness/i);
  await expect(segments.nth(1)).toContainText(/8:01\s?AM – 12:00\s?PM.*Worked/i);
  await expect(segments.nth(2)).toContainText(/1:00\s?PM – 5:00\s?PM.*Worked/i);
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
