import { expect, test, type Page } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

// Marisol Santos holds the Payroll Preparer role. The seed's synthetic salary schedules cover only
// 2850, so these periods sit there; their amounts are not rates. No Personnel table records a pay
// basis or employment fraction yet: Personnel's salary facts read (#619) answers both as null. So
// every seeded Employee in service has an INDETERMINATE compensation basis (MISSING_PAY_BASIS),
// which blocks a regular period, and no seed can supply the fact without a schema change. A special
// period that pays the cash clothing allowance with no Agency grant recorded calculates to For
// review with payslips but no lines; the Payroll Line columns are covered by unit and API tests.
const CUTOFF_PASSED = '2026-01-01T00:00';
// The calculation job runs every five seconds and the list reads again every three.
const CALCULATION_TIMEOUT = 45_000;

async function createPeriod(
  page: Page,
  period: {
    code: string;
    runType: 'REGULAR' | 'SPECIAL';
    from: string;
    to: string;
    payment: string;
    component?: string;
  },
) {
  await page.getByRole('button', { name: 'New Payroll Period' }).click();
  const form = page.getByRole('region', { name: 'New Payroll Period' });
  await form.getByLabel('Code').fill(period.code);
  await form.getByLabel('Run type').selectOption(period.runType);
  await form.getByLabel('Period from').fill(period.from);
  await form.getByLabel('Period to').fill(period.to);
  await form.getByLabel('Cutoff (Philippine time)').fill(CUTOFF_PASSED);
  await form.getByLabel('Payment date').fill(period.payment);
  if (period.component) await form.getByLabel(period.component).check();
  await form.getByRole('button', { name: 'Create period' }).click();
  await expect(page.getByText(`Payroll Period ${period.code} created in Draft.`)).toBeVisible();
  const group = page.getByRole('region', { name: period.code, exact: true });
  await expect(group.getByText('Draft', { exact: true }).first()).toBeVisible();
  await expect(group.getByText('Not calculated', { exact: true }).first()).toBeVisible();
  return group;
}

test.beforeEach(async ({ page }) => {
  await signIn(page, MARISOL_EMAIL);
  await page.goto('/payslips');
  await expect(page.getByRole('heading', { name: 'Employee Payslips', level: 1 })).toBeVisible();
});

test('creates a period and calculates it to For review for the seeded Employees', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const code = `E2E-CLOTHING-2850-${Date.now()}`;
  const group = await createPeriod(page, {
    code,
    runType: 'SPECIAL',
    from: '2850-01-01',
    to: '2850-12-31',
    payment: '2850-06-15',
    component: 'Uniform/clothing allowance (cash)',
  });

  await group.getByRole('button', { name: 'Start calculation' }).click();
  await expect(page.getByText(`Calculation of ${code} started.`)).toBeVisible();
  const stage = group.getByRole('list', { name: `${code} stage` });
  await expect(group.getByText('For review', { exact: true })).toBeVisible({
    timeout: CALCULATION_TIMEOUT,
  });
  await expect(stage.locator('[aria-current="step"]')).toHaveText('Calculated');
  await expect(group.getByText('Version 1', { exact: true })).toBeVisible();

  const payslips = group.getByRole('region', { name: `${code} payslips` });
  const alex = payslips.getByRole('row').filter({ hasText: 'Alex Rivera' });
  await expect(alex.getByText('Calculated', { exact: true })).toBeVisible();
  await expect(alex.getByRole('cell', { name: '₱0.00' }).first()).toBeVisible();

  await alex.getByRole('button', { name: 'Alex Rivera' }).click();
  const payslip = page.getByRole('region', { name: 'Alex Rivera' });
  await expect(payslip.getByText(`${code} · calculation version 1. Read-only.`)).toBeVisible();
  await expect(payslip.getByText('This payslip has no Payroll Lines.')).toBeVisible();
  await payslip.getByRole('button', { name: 'Close' }).click();
  await expect(group).toBeVisible();
});

test('returns a period with a blocking exception to Draft, where the preparer resolves it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const code = `E2E-REGULAR-2850-01-${Date.now()}`;
  const group = await createPeriod(page, {
    code,
    runType: 'REGULAR',
    from: '2850-01-01',
    to: '2850-01-31',
    payment: '2850-01-31',
  });

  await group.getByRole('button', { name: 'Start calculation' }).click();
  await expect(group.getByText('Version 1', { exact: true })).toBeVisible({
    timeout: CALCULATION_TIMEOUT,
  });
  await expect(group.getByText('Draft', { exact: true }).first()).toBeVisible();

  const payslips = group.getByRole('region', { name: `${code} payslips` });
  const alexPayslip = payslips.getByRole('row').filter({ hasText: 'Alex Rivera' });
  await expect(alexPayslip.getByText('Blocked by exception')).toBeVisible();

  const exceptions = group.getByRole('region', { name: `${code} exceptions` });
  const alexException = exceptions
    .getByRole('row')
    .filter({ hasText: 'Alex Rivera' })
    .filter({ hasText: 'Compensation basis indeterminate' })
    .first();
  await expect(alexException.getByText('Blocking', { exact: true })).toBeVisible();
  await expect(alexException.getByText('Open', { exact: true })).toBeVisible();
  // A blocking exception is never acknowledged, only resolved once its cause is fixed.
  await expect(alexException.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);

  const reason = 'Pay basis to be recorded before the next calculation.';
  await alexException.getByRole('button', { name: 'Resolve' }).click();
  await exceptions.getByLabel('Reason for resolving this exception').fill(reason);
  await exceptions.getByRole('button', { name: 'Resolve exception' }).click();
  await expect(page.getByText('Exception resolved.')).toBeVisible();
  const resolved = exceptions.getByRole('row').filter({ hasText: reason });
  await expect(resolved.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(resolved).toContainText('Alex Rivera');

  await alexPayslip.getByRole('button', { name: 'Alex Rivera' }).click();
  const payslip = page.getByRole('region', { name: 'Alex Rivera' });
  await expect(payslip.getByText('a blocking exception stopped this payslip')).toBeVisible();
  await expect(
    payslip.getByRole('region', { name: 'Payslip exceptions' }).getByText('Resolved', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(payslip.getByRole('button', { name: 'Start calculation' })).toBeVisible();
});
