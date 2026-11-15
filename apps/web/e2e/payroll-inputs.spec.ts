import { expect, test } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

// The seeded Context Reader holds only the Payroll Preparer role, so it reads and adjusts payroll
// inputs but cannot read Employees.
const APPROVER_EMAIL = 'context.reader@example.test';

test('lists Payroll Inputs by source and status and opens one to its source record', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sourceId = '00000000-0000-4000-8000-000000000629';
  await page.route(
    (url) => url.pathname.endsWith('/payroll-inputs') && url.search !== '',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          inputs: [
            {
              id: '00000000-0000-4000-8000-000000000630',
              employeeId: '00000000-0000-4000-8000-000000000631',
              sourceModule: 'LEAVE',
              inputKind: 'LEAVE_WITHOUT_PAY',
              sourceKey: 'leave-posting:e2e-629',
              sourceType: 'LeavePosting',
              sourceId,
              effectiveDate: '2026-11-12',
              quantity: '1.0000',
              amount: null,
              status: 'PENDING',
              acceptedAt: '2026-11-13T01:00:00.000Z',
              consumedByPayrollPeriodId: null,
              replacesPayrollInputId: null,
            },
          ],
        }),
      });
    },
  );

  await signIn(page, MARISOL_EMAIL);
  await page.goto('/payroll-inputs');
  await expect(page.getByRole('heading', { name: 'Payroll Inputs', level: 1 })).toBeVisible();

  const filtered = page.waitForRequest(
    (request) => request.url().includes('/payroll-inputs?') && request.url().includes('status='),
  );
  await page.getByLabel('Source').selectOption('LEAVE');
  await page.getByLabel('Status').selectOption('PENDING');
  const url = new URL((await filtered).url());
  expect(url.searchParams.get('sourceModule')).toBe('LEAVE');
  expect(url.searchParams.get('status')).toBe('PENDING');

  const row = page.getByRole('row').filter({ hasText: 'Leave Posting' });
  await expect(row.getByText('Pending', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Leave without pay' }).click();

  const input = page.getByRole('region', { name: 'Leave without pay' });
  await expect(input.getByText('Not used by a payroll yet')).toBeVisible();
  const source = input.getByRole('region', { name: 'Source record' });
  await expect(source.getByText('Leave Posting', { exact: true })).toBeVisible();
  await expect(source.getByText(sourceId)).toBeVisible();
  await expect(source.getByRole('link', { name: 'Open Leave Applications' })).toHaveAttribute(
    'href',
    '/leave-applications',
  );
  await input.getByRole('button', { name: 'Close' }).click();
  await expect(row).toBeVisible();
});

test('records an Authorized Payroll Component Input that another person approves', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const reference = `E2E Office Order ${Date.now()}`;

  await signIn(page, MARISOL_EMAIL);
  await page.goto('/authorized-payroll-component-inputs');
  await expect(
    page.getByRole('heading', { name: 'Authorized Component Inputs', level: 1 }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Record input' }).click();
  const form = page.getByRole('region', { name: 'Record Authorized Payroll Component Input' });
  await form
    .getByLabel('Pay component')
    .selectOption({ label: 'E2E synthetic authorized component (E2E-AUTHORIZED-COMPONENT)' });
  await form.getByLabel('Applies to').selectOption('EMPLOYEE');
  await form.getByLabel(/^Employee/).selectOption({ label: 'E2E-0001 · Alex Rivera' });
  await form.getByLabel('Value kind').selectOption('AMOUNT');
  await form.getByLabel('Payment schedule').selectOption('ONCE');
  await form.getByLabel('Authority document').selectOption({ label: 'E2E-PAYROLL-AUTHORITY · v1' });
  await form.getByLabel('Source reference').fill(reference);
  await form.getByLabel('Effective from').fill('2026-12-01');

  // The API refuses a zero value and the form shows its reason.
  await form.getByLabel('Value', { exact: true }).fill('0');
  await form.getByRole('button', { name: 'Record input' }).click();
  await expect(form.getByRole('alert')).toContainText('The value must be greater than zero.');

  await form.getByLabel('Value', { exact: true }).fill('1500');
  await form.getByRole('button', { name: 'Record input' }).click();

  const recorded = page.getByRole('region', { name: 'E2E synthetic authorized component' });
  await expect(recorded.getByText('Recorded, not approved')).toBeVisible();
  await expect(recorded.getByText('Not approved yet')).toBeVisible();

  // The recorder cannot approve their own input.
  await recorded.getByRole('button', { name: 'Approve input' }).click();
  await expect(recorded.getByRole('alert')).toHaveText(
    'The recorder of an Authorized Payroll Component Input cannot approve it.',
  );
  await recorded.getByRole('button', { name: 'Close' }).click();

  const recorderRow = page.getByRole('row').filter({ hasText: reference });
  await expect(recorderRow).toContainText('Alex Rivera');
  await expect(recorderRow).toContainText('1500');
  await expect(recorderRow.getByText('Recorded, not approved')).toBeVisible();

  const approverContext = await browser.newContext();
  const approver = await approverContext.newPage();
  await signIn(approver, APPROVER_EMAIL);
  await approver.goto('/authorized-payroll-component-inputs');
  const pendingRow = approver.getByRole('row').filter({ hasText: reference });
  await pendingRow.getByRole('button', { name: 'E2E synthetic authorized component' }).click();
  const pending = approver.getByRole('region', { name: 'E2E synthetic authorized component' });
  await pending.getByRole('button', { name: 'Approve input' }).click();
  await expect(pending.getByRole('status')).toHaveText('Approved.');
  await expect(pending.getByText('Approved', { exact: true })).toBeVisible();
  await expect(pending.getByRole('button', { name: 'Approve input' })).toHaveCount(0);
  await pending.getByRole('button', { name: 'Close' }).click();
  await expect(pendingRow.getByText('Approved', { exact: true })).toBeVisible();
  await approverContext.close();

  await page.reload();
  await expect(
    page.getByRole('row').filter({ hasText: reference }).getByText('Approved', { exact: true }),
  ).toBeVisible();
});
