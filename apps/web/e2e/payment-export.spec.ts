import { expect, test, type Page } from '@playwright/test';
import { signIn } from './sign-in';

// The seed's Agency E2E-PAYMENT-EXPORT holds two Finalized periods. E2E-PAYEXPORT-2848-CLOTHING
// pays E2E Payment Payee 1,000.00 to a verified LBP account; E2E-PAYEXPORT-2848-BLOCKED pays
// E2E-PAYEXPORT-0002, who has no Payroll Bank Account. `payment.cashier@` is the Cashier and
// `payment.preparer@` the Payroll Preparer who corrects the rejected destination. Its amounts
// establish no rule.
const CODE = 'E2E-PAYEXPORT-2848-CLOTHING';
const BLOCKED_CODE = 'E2E-PAYEXPORT-2848-BLOCKED';
const CASHIER = 'payment.cashier@example.test';
const PREPARER = 'payment.preparer@example.test';
const PAYEE = 'E2E Payment Payee';
// Repeated from seed-protected-shell-e2e.ts.
const AGENCY_ID = 'a9c00000-0000-4000-8000-0000000000a0';
const EMPLOYEE_ID = 'a9c00000-0000-4000-8000-0000000000e1';
const ACCOUNT_ID = 'a9c00000-0000-4000-8000-000000000003';

async function openReports(page: Page) {
  await page.context().clearCookies();
  await signIn(page, CASHIER);
  await page.goto('/dashboard');
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await navigation.getByRole('button', { name: 'Payroll' }).click();
  await navigation.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/payroll-reports$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
}

/** The Cashier opens the payslip's form from the period and returns its Payment section. */
async function openPayment(page: Page) {
  await page.goto('/payslips');
  await expect(page.getByRole('heading', { name: 'Employee Payslips', level: 1 })).toBeVisible();
  const group = page.getByRole('region', { name: CODE, exact: true });
  await group.getByRole('button', { name: `Expand ${CODE}` }).click();
  await group
    .getByRole('region', { name: `${CODE} payslips` })
    .getByRole('button', { name: PAYEE })
    .click();
  const form = page.getByRole('region', { name: PAYEE, exact: true });
  return form.getByRole('region', { name: 'Payment', exact: true });
}

async function recordOutcome(attempt: ReturnType<Page['getByRole']>, outcome: string, reason = '') {
  await attempt.getByRole('button', { name: 'Record outcome' }).click();
  const form = attempt.getByRole('form', { name: 'Record Disbursement Outcome' });
  await form.getByLabel('Outcome').selectOption({ label: outcome });
  if (reason) await form.getByLabel('Reason (Rejected or Returned only)').fill(reason);
  await form.getByRole('button', { name: 'Record outcome' }).click();
  await expect(form).toHaveCount(0);
}

test('generates a Payment Export, records a REJECTED outcome, and supersedes the instruction', async ({
  page,
}) => {
  test.setTimeout(240_000);

  // A blocked export says why, and stores nothing.
  await openReports(page);
  const period = page.getByLabel('Payroll Period');
  await period.selectOption({ label: BLOCKED_CODE });
  let outputs = page.getByRole('region', { name: `${BLOCKED_CODE} outputs` });
  await outputs.getByRole('button', { name: 'Generate Payment Export' }).click();
  await expect(outputs).toContainText('Blocked');
  await expect(outputs).toContainText(
    'The Payment Export is blocked: no Payroll Bank Account for E2E-PAYEXPORT-0002. Nothing was generated.',
  );
  await expect(outputs.getByRole('button', { name: 'Generate again' })).toBeVisible();

  // Generating hands off one instruction and never reads as paid.
  await period.selectOption({ label: CODE });
  outputs = page.getByRole('region', { name: `${CODE} outputs` });
  await outputs.getByRole('button', { name: 'Generate Payment Export' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'It marks no one paid' })).toBeVisible();
  await expect(outputs).toContainText('Generated');
  await expect(outputs).toContainText('1 instruction · ₱1,000.00');
  await expect(outputs).not.toContainText(/\bPaid\b/);
  const download = page.waitForEvent('download');
  await outputs.getByRole('link', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^payment-export-.+-v1\.csv$/);

  // On the payslip, the instruction has no outcome yet; the Cashier records two, in order.
  let payment = await openPayment(page);
  let attempt = payment.getByRole('region', { name: 'Payment attempt 1' });
  await expect(attempt).toContainText('No outcome yet');
  await expect(attempt.getByRole('button', { name: 'Supersede instruction' })).toHaveCount(0);
  await recordOutcome(attempt, 'Submitted');
  await recordOutcome(attempt, 'Rejected', 'Account closed by the bank');
  const outcomes = attempt
    .getByRole('list', { name: 'Disbursement Outcomes' })
    .getByRole('listitem');
  await expect(outcomes).toHaveCount(2);
  await expect(outcomes.nth(0)).toContainText('Submitted');
  await expect(outcomes.nth(1)).toContainText('Rejected');
  await expect(outcomes.nth(1)).toContainText('Account closed by the bank');

  // Superseding before the destination is corrected is refused, with the API's reason.
  await attempt.getByRole('button', { name: 'Supersede instruction' }).click();
  let supersede = attempt.getByRole('form', { name: 'Supersede instruction' });
  await supersede.getByLabel('Reason').fill('The Employee gave a corrected account');
  await supersede.getByRole('button', { name: 'Supersede instruction' }).click();
  await expect(supersede.getByRole('alert')).toContainText(
    'would resend to the Payroll Bank Account of its prior attempt',
  );

  // The Payroll Preparer corrects the Employee's destination.
  await page.context().clearCookies();
  await signIn(page, PREPARER);
  const origin = new URL(page.url()).origin;
  const corrected = await page.request.post(
    `/api/v1/agencies/${AGENCY_ID}/employees/${EMPLOYEE_ID}/payroll-bank-accounts/${ACCOUNT_ID}/correct`,
    {
      headers: { origin },
      data: {
        bankCode: 'LBP',
        accountName: PAYEE,
        accountNumber: '0099887766',
        reason: 'The bank rejected the closed account; the Employee gave a corrected one.',
      },
    },
  );
  expect(corrected.ok()).toBe(true);

  // The Cashier supersedes the rejected instruction; a second attempt goes to the corrected account.
  await page.context().clearCookies();
  await signIn(page, CASHIER);
  payment = await openPayment(page);
  attempt = payment.getByRole('region', { name: 'Payment attempt 1' });
  await attempt.getByRole('button', { name: 'Supersede instruction' }).click();
  supersede = attempt.getByRole('form', { name: 'Supersede instruction' });
  await supersede.getByLabel('Reason').fill('The Employee gave a corrected account');
  await supersede.getByRole('button', { name: 'Supersede instruction' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'superseded' })).toBeVisible();
  await expect(attempt).toContainText('Superseded');
  await expect(attempt.getByRole('button', { name: 'Supersede instruction' })).toHaveCount(0);
  const retry = payment.getByRole('region', { name: 'Payment attempt 2' });
  await expect(retry).toContainText('No outcome yet');
  await expect(retry).toContainText('7766');
  await expect(retry).toContainText('The Employee gave a corrected account');

  // Reports lists the superseding export beside the original.
  await openReports(page);
  await page.getByLabel('Payroll Period').selectOption({ label: CODE });
  outputs = page.getByRole('region', { name: `${CODE} outputs` });
  await expect(outputs.getByRole('row', { name: /Payment Export, superseding/ })).toBeVisible();
  await expect(outputs.getByRole('link', { name: 'Download CSV' })).toHaveCount(2);
});
