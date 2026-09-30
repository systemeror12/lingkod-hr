import { expect, test, type Page } from '@playwright/test';

const alex = 'E2E-0001 · Alex Rivera';

async function openRegister(page: Page, search = ''): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/attendance-contexts' + search);
}

async function fillTimedContext(page: Page, reason: string): Promise<void> {
  await page.getByLabel('Employee').selectOption({ label: alex });
  await page.getByRole('radio', { name: 'Exact time range' }).check();
  await page.getByLabel('Starts (Manila time)').fill('2026-09-10T09:00');
  await page.getByLabel('Ends (Manila time)').fill('2026-09-10T11:30');
  await page.getByLabel('Reason').fill(reason);
  await page.getByLabel('Source type (link one authoritative record)').fill('TravelOrder');
  await page.getByLabel('Source identifier').fill('33333333-3333-4333-8333-333333333333');
}

// Sorts after phase-7-attendance-contexts.spec.ts, which counts the records it recorded.
test.describe('outside UTC+8', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('reads exact times as Manila time', async ({ page }) => {
    await openRegister(page, '?view=form&new=context');
    const reason = 'Timezone coverage — E2E ' + Date.now();
    await fillTimedContext(page, reason);
    await page.getByRole('button', { name: 'Record Attendance Context', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Attendance Context recorded');
    await expect(page.getByText('Sep 10, 2026, 9:00 AM – Sep 10, 2026, 11:30 AM')).toBeVisible();
  });
});

test('loads Employees with the record form however it is opened', async ({ page }) => {
  const option = (p: Page) => p.getByLabel('Employee').getByRole('option', { name: alex });

  await openRegister(page, '?view=form&new=context');
  await expect(option(page)).toHaveCount(1);

  await page.reload();
  await expect(option(page)).toHaveCount(1);

  await openRegister(page);
  await page.getByRole('button', { name: 'Form', exact: true }).click();
  await expect(option(page)).toHaveCount(1);
});

test('does not fetch the list again on load', async ({ page }) => {
  const listRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/agencies\/[^/]+\/attendance-contexts$/.test(new URL(request.url()).pathname)) {
      listRequests.push(request.method());
    }
  });
  await openRegister(page);
  await expect(page.getByRole('table', { name: 'Attendance Contexts' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(listRequests).toEqual([]);
});

test('reports a saved record when the list refresh fails', async ({ page }) => {
  await openRegister(page, '?view=form&new=context');
  const reason = 'Refresh failure — E2E ' + Date.now();
  await fillTimedContext(page, reason);

  const posts: string[] = [];
  await page.route('**/api/v1/agencies/*/attendance-contexts', (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      posts.push(method);
      return route.continue();
    }
    return route.abort('failed');
  });
  await page.getByRole('button', { name: 'Record Attendance Context', exact: true }).click();

  const notice = page.getByText(/^Attendance Context recorded, but the register could not refresh/);
  await expect(notice).toBeVisible();
  await expect(page.getByText('Recording the context failed')).toHaveCount(0);
  await expect(page.getByLabel('Reason')).toHaveValue('');
  expect(posts).toHaveLength(1);
});
