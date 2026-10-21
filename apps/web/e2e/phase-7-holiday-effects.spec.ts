import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { activateInvitation, MARISOL_EMAIL, signIn } from './sign-in';

const dtrMembershipId = 'd7a00000-0000-4000-8000-000000000002';
const dtrReviewerInvitationToken = 'dtr-reviewer-invitation-token-0000000000000';
const calendarCode = 'DTR-YEAR-END';
const periodCode = 'E2E-DTR-HOLIDAY-2025-12';
// A Tuesday. Successor calendar versions and Schedule Assignment ends are prospective only, so the
// journey uses a first calendar version in the month before the fixture's 2026-01-01 assignment.
const holidayDate = '2025-12-30';
const dutyDates = ['2025-12-29', '2025-12-31'] as const;

function runDatabaseScript(args: string[]): void {
  execFileSync('pnpm', ['--filter', '@lingkod-hr/database', ...args], {
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

async function selectOptionByText(select: Locator, text: string): Promise<void> {
  const option = select.locator('option', { hasText: text });
  await expect(option).toHaveCount(1);
  await select.selectOption((await option.getAttribute('value')) ?? '');
}

/**
 * Selects the Attendance Period until `selected` shows it took effect. A choice made before
 * hydration sticks in the native select, so each attempt moves away first to fire a real change.
 */
async function selectPeriod(page: Page, periodId: string, selected: Locator): Promise<void> {
  const select = page.getByRole('combobox', { name: 'Attendance Period' });
  await expect(async () => {
    await select.selectOption({ index: 0 });
    await select.selectOption(periodId);
    await expect(selected).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

test('finalizes a Daily Time Record containing a weekday Non-Working Holiday with no absence on the holiday', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  runDatabaseScript(['e2e:seed:shell']);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, MARISOL_EMAIL, { membershipId: dtrMembershipId });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();

  // Activate the Holiday Calendar Version that declares the weekday Regular Holiday.
  await page.goto('/attendance-configuration');
  const calendarsTab = page.getByRole('tab', { name: 'Holiday Calendars' });
  await expect(async () => {
    await calendarsTab.click();
    await expect(calendarsTab).toHaveAttribute('aria-selected', 'true', { timeout: 2_000 });
  }).toPass();
  await page.getByRole('button', { name: 'Create Holiday Calendar' }).click();
  await page.getByLabel('Holiday Calendar code').fill(calendarCode);
  await page.getByLabel('Holiday Calendar name').fill('DTR Year-End Holidays');
  await page.getByLabel('Scope reference').fill('Agency-wide');
  await page.getByLabel('Effective date').fill('2025-12-01');
  await page.getByLabel('Holiday date 1').fill(holidayDate);
  await page.getByLabel('Holiday name 1').fill('Rizal Day');
  await expect(page.getByLabel('Holiday day type 1')).toHaveValue('REGULAR_HOLIDAY');
  await page.getByLabel('Holiday source 1').fill('E2E Proclamation Fixture');
  await page.getByRole('button', { name: 'Create Draft' }).click();
  await expect(page.getByRole('status')).toContainText(
    `Draft Holiday Calendar “${calendarCode}” was created.`,
  );
  const calendarRow = page
    .getByRole('region', { name: 'Holiday Calendar register' })
    .getByRole('row')
    .filter({ hasText: calendarCode });
  await calendarRow.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByRole('dialog', { name: `Activate ${calendarCode}` })).toBeVisible();
  await selectOptionByText(
    page.getByLabel('Authority Document Version'),
    'SCHEDULE_ASSIGNMENT_AUTHORITY',
  );
  await page.getByLabel('Approving authority').fill('Office of the President');
  await page.getByLabel('Activation reason').fill('Year-end holidays adopted for the DTR journey.');
  await page.getByRole('button', { name: 'Activate Version' }).click();
  await expect(page.getByRole('status')).toContainText(
    `Holiday Calendar “${calendarCode}” was activated.`,
  );
  await expect(calendarRow).toContainText('v1 · 1 entry');

  runDatabaseScript(['exec', 'tsx', 'scripts/seed-holiday-dtr-e2e.ts', calendarCode]);

  // Record full duty on the days around the holiday and nothing on the holiday itself.
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
  for (const workDate of dutyDates) {
    for (const [eventType, timeValue] of [
      ['TIME_IN', '08:00'],
      ['BREAK_OUT', '12:00'],
      ['BREAK_IN', '13:00'],
      ['TIME_OUT', '17:00'],
    ] as const) {
      await apiBody(
        await page.request.post(`${agencyBase}/attendance/events`, {
          headers,
          data: {
            employeeId: employee.id,
            eventType,
            eventTime: `${workDate}T${timeValue}:00+08:00`,
            reason: 'Protected holiday Daily Time Record fixture.',
          },
        }),
      );
    }
  }
  const calculated = await apiBody<{ period: { id: string } }>(
    await page.request.post(`${agencyBase}/attendance-days/calculate`, {
      headers,
      data: {
        periodCode,
        dateFrom: dutyDates[0],
        dateTo: dutyDates[1],
        employeeIds: [employee.id],
      },
    }),
  );

  await page.goto('/attendance-dtrs');
  await selectPeriod(
    page,
    calculated.period.id,
    page.getByText(`Selected Attendance Period ${periodCode}`),
  );
  const preview = page.getByRole('region', { name: 'Unfinalized Daily Time Record Preview' });
  await expect(
    preview.getByRole('row').filter({ hasText: holidayDate }).getByRole('cell'),
  ).toHaveText(['No recorded event presentation.', '0:00', '0:00', '0:00']);

  // Submit and approve through the API; a second person reviews.
  const submission = await apiBody<{ submission: { id: string } }>(
    await page.request.post(`${agencyBase}/attendance-submissions`, {
      headers,
      data: { attendancePeriodId: calculated.period.id },
    }),
  );
  await apiBody(
    await page.request.post(
      `${agencyBase}/attendance-submissions/${submission.submission.id}/submit`,
      { headers, data: {} },
    ),
  );
  const reviewerContext = await browser.newContext();
  try {
    const reviewerPage = await reviewerContext.newPage();
    await activateInvitation(reviewerPage, `/invite/${dtrReviewerInvitationToken}`);
    const reviewerHeaders = { origin: new URL(reviewerPage.url()).origin };
    await apiBody(
      await reviewerPage.request.post(
        `${agencyBase}/attendance-submissions/${submission.submission.id}/approve`,
        { headers: reviewerHeaders, data: {} },
      ),
    );
    const { version } = await apiBody<{ version: { id: string } }>(
      await page.request.post(`${agencyBase}/attendance-periods/${calculated.period.id}/versions`, {
        headers,
      }),
    );
    await apiBody(
      await reviewerPage.request.post(
        `${agencyBase}/attendance-period-versions/${version.id}/approve`,
        { headers: reviewerHeaders, data: {} },
      ),
    );
  } finally {
    await reviewerContext.close();
  }

  // Locking the approved version finalizes the DTR.
  await page.goto('/attendance-periods');
  const versions = page.getByRole('region', { name: 'Attendance Period Versions' });
  await selectPeriod(
    page,
    calculated.period.id,
    versions.getByRole('row', { name: /Version 1\b.*APPROVED/ }),
  );
  await versions.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('status').first()).toContainText(
    'Attendance Period Version locked with its publication.',
  );
  await expect(versions.getByRole('row', { name: /Version 1\b.*LOCKED/ })).toBeVisible();

  // Read the holiday row from the Finalized DTR's printable view.
  await page.goto('/attendance-dtrs');
  await selectPeriod(
    page,
    calculated.period.id,
    page.getByText(`Selected Attendance Period ${periodCode}`),
  );
  const register = page.getByRole('region', { name: 'Finalized Daily Time Records' });
  await register.getByRole('button', { name: /DTR Journey Employee/ }).click();
  const detail = page.getByRole('region', { name: 'Finalized Daily Time Record detail' });
  await expect(detail).toContainText('3 Attendance Day versions');
  const [printPage] = await Promise.all([
    page.waitForEvent('popup'),
    detail.getByRole('link', { name: 'Print Daily Time Record' }).click(),
  ]);
  await expect(printPage.locator('h1')).toHaveText('Daily Time Record');
  await expect(printPage.locator('body')).not.toContainText('unresolved Attendance Exception');
  // Work date, presentation, Expected, Worked, Coverage, Tardiness, Undertime, Absence.
  const printedRow = (workDate: string) =>
    printPage.getByRole('row').filter({ hasText: workDate }).getByRole('cell');
  await expect(printedRow(holidayDate)).toHaveText([
    new RegExp(holidayDate),
    'No recorded event presentation.',
    '0:00',
    '0:00',
    '0:00',
    '0:00',
    '0:00',
    '0:00',
  ]);
  for (const workDate of dutyDates) {
    await expect(printedRow(workDate)).toHaveText([
      new RegExp(workDate),
      /AM In 08:00.*PM Out 17:00/,
      '8:00',
      '8:00',
      '8:00',
      '0:00',
      '0:00',
      '0:00',
    ]);
  }
});
