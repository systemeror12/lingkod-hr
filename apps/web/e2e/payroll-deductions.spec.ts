import { expect, test } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

// Marisol Santos holds the Payroll Preparer role, which manages Deduction Obligations and records
// contribution billing. The seed's synthetic authorized-deductions rule version allows GSIS and
// HDMF payees only in 2850, so the obligation and the period sit there; the amounts are not rates.
// No seeded Employee calculates in a regular period (payroll-periods.spec.ts says why), so the
// Contribution, Tax, and Loan Deduction Lines a calculation writes are covered by unit and API
// tests; this spec records the obligation and the billing and reads their lines.
const AUTHORITY = 'E2E-PAYROLL-AUTHORITY · v1';
const ALEX = 'E2E-0001 · Alex Rivera';

test.beforeEach(async ({ page }) => {
  await signIn(page, MARISOL_EMAIL);
});

test('records a loan obligation for a seeded Employee and reads its line', async ({ page }) => {
  const reference = `E2E-GSIS-LOAN-${Date.now()}`;
  await page.goto('/deduction-obligations');
  await expect(
    page.getByRole('heading', { name: 'Deduction Obligations', level: 1 }),
  ).toBeVisible();

  await page.getByLabel('Employee').selectOption({ label: ALEX });
  await page.getByRole('button', { name: 'Record obligation' }).click();
  const form = page.getByRole('region', { name: 'Record Deduction Obligation' });
  await form.getByLabel('Payee category').selectOption('GSIS');
  await form.getByLabel('Payee name').fill('Government Service Insurance System');
  await form.getByLabel('Issuer reference').fill(reference);
  await form.getByLabel('Incurred on').fill('2850-01-10');
  await form.getByLabel('Outstanding balance').fill('12000');
  await form.getByLabel('Scheduled amount per payroll').fill('1000');
  await form.getByLabel('Effective from').fill('2850-02-01');
  await form.getByLabel('Authority document').selectOption({ label: AUTHORITY });
  await form.getByRole('button', { name: 'Record obligation' }).click();

  await expect(
    page.getByText(`Obligation ${reference} to Government Service Insurance System recorded.`),
  ).toBeVisible();
  const row = page
    .getByRole('region', { name: 'Alex Rivera obligations' })
    .getByRole('row')
    .filter({ hasText: reference });
  await expect(row).toContainText('Government Service Insurance System');
  await expect(row).toContainText('₱12,000.00');
  await expect(row).toContainText('₱1,000.00');
  await expect(row).toContainText('From Feb 1, 2850');
  await expect(row.getByText('Active', { exact: true })).toBeVisible();
});

test('records issuer billing for a Draft regular period, corrects it, and reads its lines', async ({
  page,
}) => {
  const code = `E2E-BILLING-2850-03-${Date.now()}`;
  await page.goto('/payslips');
  await page.getByRole('button', { name: 'New Payroll Period' }).click();
  const create = page.getByRole('region', { name: 'New Payroll Period' });
  await create.getByLabel('Code').fill(code);
  await create.getByLabel('Run type').selectOption('REGULAR');
  await create.getByLabel('Period from').fill('2850-03-01');
  await create.getByLabel('Period to').fill('2850-03-31');
  await create.getByLabel('Cutoff (Philippine time)').fill('2026-01-01T00:00');
  await create.getByLabel('Payment date').fill('2850-03-31');
  await create.getByRole('button', { name: 'Create period' }).click();
  await expect(page.getByText(`Payroll Period ${code} created in Draft.`)).toBeVisible();

  const group = page.getByRole('region', { name: code, exact: true });
  const billing = group.getByRole('region', { name: `${code} contribution billing` });
  await expect(billing.getByText('No issuer billing recorded for this period.')).toBeVisible();

  async function recordBilling(employeeShare: string, employerShare: string) {
    await billing.getByRole('button', { name: `Record billing for ${code}` }).click();
    const form = page.getByRole('region', { name: 'Record contribution billing' });
    await form.getByLabel('Contribution').selectOption({ label: 'PhilHealth' });
    await form.getByLabel('Billing statement').selectOption({ label: AUTHORITY });
    await form.getByLabel('Employee 1').selectOption({ label: ALEX });
    await form.getByLabel('Employee share 1').fill(employeeShare);
    await form.getByLabel('Employer share 1').fill(employerShare);
    await form.getByRole('button', { name: 'Record billing' }).click();
    await expect(
      page.getByText(
        'PhilHealth billing recorded for 1 Employee. The next calculation compares it.',
      ),
    ).toBeVisible();
  }

  await recordBilling('100.00', '100.00');
  const rows = billing.getByRole('row').filter({ hasText: 'Alex Rivera' });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('PhilHealth');
  await expect(rows.first()).toContainText('₱100.00');
  await expect(rows.first()).toContainText(AUTHORITY);
  await expect(rows.first().getByText('Current', { exact: true })).toBeVisible();

  // Recording the Employee again corrects the billing; the earlier line stays, superseded.
  await recordBilling('120.00', '120.00');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: '₱100.00' }).getByText('Superseded')).toBeVisible();
  await expect(
    rows.filter({ hasText: '₱120.00' }).getByText('Current', { exact: true }),
  ).toBeVisible();
});
