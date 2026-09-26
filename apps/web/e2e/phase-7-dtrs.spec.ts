import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

const dtrMembershipId = 'd7a00000-0000-4000-8000-000000000002';

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

async function loginDtrWorkspace(page: Page): Promise<void> {
  await page.goto(`/api/v1/auth/login?membershipId=${dtrMembershipId}`);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
}

test('prepares, submits, reviews, returns, and resubmits an Employee Attendance Submission from the protected workspace', async ({
  page,
}) => {
  test.setTimeout(180_000);
  resetFixture();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginDtrWorkspace(page);

  const headers = { origin: new URL(page.url()).origin };
  const session = await apiBody<{ agencyId: string }>(
    await page.request.get('/api/v1/auth/me', { headers }),
  );
  const agencyBase = `/api/v1/agencies/${session.agencyId}`;
  const employees = await apiBody<{ employees: Array<{ id: string; employeeNumber: string }> }>(
    await page.request.get(`${agencyBase}/employees`, { headers }),
  );
  const employee = employees.employees.find(
    ({ employeeNumber }) => employeeNumber === 'E2E-DTR-0001',
  );
  if (!employee) throw new Error('The E2E-DTR-0001 Employee fixture is missing.');
  const workDate = recentWeekday();
  for (const [eventType, timeValue] of [
    ['TIME_IN', '08:00'],
    ['BREAK_OUT', '12:00'],
    ['BREAK_IN', '13:00'],
    ['TIME_OUT', '16:00'],
  ] as const) {
    await apiBody(
      await page.request.post(`${agencyBase}/attendance/events`, {
        headers,
        data: {
          employeeId: employee.id,
          eventType,
          eventTime: `${workDate}T${timeValue}:00+08:00`,
          reason: 'Protected Daily Time Record fixture.',
        },
      }),
    );
  }
  await apiBody(
    await page.request.post(`${agencyBase}/attendance-days/calculate`, {
      headers,
      data: {
        periodCode: `E2E-DTR-${workDate}`,
        dateFrom: workDate,
        dateTo: workDate,
        employeeIds: [employee.id],
      },
    }),
  );

  await page.goto('/attendance-dtrs');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Daily Time Records', exact: true }),
  ).toBeVisible();
  const preview = page.getByRole('region', { name: 'Unfinalized Daily Time Record Preview' });
  await expect(preview.getByText('Unfinalized preview')).toBeVisible();
  await expect(preview).toContainText('AM In 08:00:00');
  await expect(preview).toContainText('AM Out 12:00:00');
  await expect(preview).toContainText('PM In 13:00:00');
  await expect(preview).toContainText('PM Out 16:00:00');

  await preview.getByRole('button', { name: 'Create draft submission' }).click();
  await expect(page.getByRole('status').first()).toContainText('Submission draft created.');
  const own = page.getByRole('region', { name: 'My attendance submission' });
  await expect(own).toContainText('DRAFT');

  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('status').first()).toContainText(
    'Exact Attendance Day versions submitted for HR review.',
  );
  await expect(own).toContainText('SUBMITTED');

  const review = page.getByRole('region', { name: 'HR review' });
  await expect(review).toContainText('DTR Journey Employee');
  await review.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('submitter cannot approve')).toBeVisible();

  await review.getByLabel('Decision comments').fill('Please confirm the recorded time out.');
  await review.getByRole('button', { name: 'Return' }).click();
  await expect(page.getByRole('status').first()).toContainText(
    'Submission returned with a reason.',
  );
  await expect(own).toContainText('RETURNED');
  await expect(own).toContainText('Please confirm the recorded time out.');

  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(own).toContainText('SUBMITTED');
});

test('materializes and prints a Finalized Daily Time Record for a locked Attendance Period Version', async ({
  page,
}) => {
  test.setTimeout(120_000);
  resetFixture();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginDtrWorkspace(page);

  await page.goto('/attendance-dtrs');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Daily Time Records', exact: true }),
  ).toBeVisible();

  const register = page.getByRole('region', { name: 'Finalized Daily Time Records' });
  await expect(register.getByText('No Finalized Daily Time Record exists')).toBeVisible();
  await register.getByRole('button', { name: 'Generate Finalized DTRs' }).click();
  await expect(page.getByRole('status').first()).toContainText(
    'Finalized Daily Time Records materialized for the locked version.',
  );

  await expect(register).toContainText('DTR Journey Employee (E2E-DTR-0001)');
  await expect(register).toContainText('Version 1 · ORIGINAL · PRINTABLE_SYSTEM_VIEW · Current');
  await register.getByRole('button', { name: /DTR Journey Employee/ }).click();
  const detail = page.getByRole('region', { name: 'Finalized Daily Time Record detail' });
  await expect(detail).toContainText('Version 1');
  await expect(detail).toContainText('ORIGINAL');
  await expect(detail).toContainText('PRINTABLE_SYSTEM_VIEW');

  const [printPage] = await Promise.all([
    page.waitForEvent('popup'),
    detail.getByRole('link', { name: 'Print Daily Time Record' }).click(),
  ]);
  await expect(printPage.locator('h1')).toHaveText('Daily Time Record');
  await expect(printPage.locator('body')).toContainText('Printable System View');
  await expect(printPage.locator('body')).toContainText('Version 1 · ORIGINAL');
  await expect(printPage.locator('body')).toContainText('2026-01-06T04:00:00.000Z');
  await expect(printPage.locator('body')).toContainText('AM In');
  await expect(printPage.locator('body')).toContainText('PM Out');
  await expect(printPage.locator('body')).not.toContainText('UNFINALIZED PREVIEW');
  await expect(printPage.locator('body')).not.toContainText('Signed by');
  await expect(printPage.locator('body')).not.toContainText('Civil Service Form');
});
