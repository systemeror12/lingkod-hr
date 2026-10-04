import { expect, test, type Page } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

const alex = 'E2E-0001 · Alex Rivera';
const message =
  'Work Date 2026-01-15 is in locked Attendance Period E2E-2026-01. Record this change through an Attendance Correction.';

// The API refusal is covered against PostgreSQL; these check each form shows it.
async function refuseLockedWorkDate(page: Page, pattern: string): Promise<void> {
  await page.route(pattern, (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'ATTENDANCE_WORK_DATE_LOCKED', message, requestId: 'e2e' },
      }),
    });
  });
}

async function openDashboard(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
}

test('the Attendance Context form shows a locked Work Date refusal', async ({ page }) => {
  await openDashboard(page);
  await page.goto('/attendance-contexts?view=form&new=context');
  await page.getByLabel('Employee').selectOption({ label: alex });
  await page.getByRole('radio', { name: 'Exact time range' }).check();
  await page.getByLabel('Starts (Manila time)').fill('2026-01-15T09:00');
  await page.getByLabel('Ends (Manila time)').fill('2026-01-15T11:30');
  await page.getByLabel('Reason').fill('Locked Work Date — E2E');
  await page.getByLabel('Source type (link one authoritative record)').fill('TravelOrder');
  await page.getByLabel('Source identifier').fill('33333333-3333-4333-8333-333333333333');
  await refuseLockedWorkDate(page, '**/api/v1/agencies/*/attendance-contexts');

  await page.getByRole('button', { name: 'Record Attendance Context', exact: true }).click();

  await expect(page.getByText(message)).toBeVisible();
});

test('the manual Attendance Event form shows a locked Work Date refusal', async ({ page }) => {
  await openDashboard(page);
  await page.goto('/attendance');
  const manual = page.getByRole('region', { name: 'Record manual Attendance Event' });
  await manual.getByLabel('Employee').selectOption({ label: alex });
  await manual.getByLabel('Event type').selectOption('TIME_IN');
  await manual.getByLabel('Event date').fill('2026-01-15');
  await manual.getByLabel('Event time').fill('08:00');
  await manual.getByLabel('Reason').fill('Locked Work Date — E2E');
  await refuseLockedWorkDate(page, '**/api/v1/agencies/*/attendance/events');

  await manual.getByRole('button', { name: 'Record Event' }).click();

  await expect(manual.getByText(message)).toBeVisible();
});
