import { expect, test, type Locator, type Page } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

// seed-protected-shell-e2e.ts seedPayrollCorrectionsFixture(): in the Work Queue Agency,
// E2E-CORRECTION-2850-CLOTHING is Finalized, and Alex Rivera's Payroll Adjustment against it waits
// Open on a Leave source correction. Recalculating it gives a synthetic ₱500.00, since no
// calculation here can write a non-zero line (payroll-periods.spec.ts says why).
// E2E-CORRECTION-2851-02 is the latest regular period, Finalized, to void and replace. One seeded
// User acts in each payroll function, so the one-function rule (#330) never stops a step. Its
// amounts establish no rule.
const ORIGINAL = 'E2E-CORRECTION-2850-CLOTHING';
const TO_VOID = 'E2E-CORRECTION-2851-02';
const CERTIFIER = 'payroll.certifier@example.test';
const BUDGET = 'payroll.budget@example.test';
const ACCOUNTING = 'payroll.accounting@example.test';
const APPROVER = 'payroll.approver@example.test';
const VOID_APPROVER = 'payroll.void.approver@example.test';
// Repeated from seed-protected-shell-e2e.ts: Users who cannot list Document Versions type it.
const EVIDENCE_VERSION_ID = 'a9a00000-0000-4000-8000-000000000003';
const CUTOFF_PASSED = '2026-01-01T00:00';
// The calculation job runs every five seconds and the list reads again every three.
const CALCULATION_TIMEOUT = 45_000;

// An Agency holds one open regular period at a time, and later specs in the same run create
// their own, so the void test cancels its replacement Draft however it ends.
let draftRegularCode: string | null = null;

test.afterEach(async ({ page }) => {
  if (!draftRegularCode) return;
  await openAs(page, MARISOL_EMAIL, '/payslips');
  await cancelDraftPeriod(page, draftRegularCode);
  draftRegularCode = null;
});

async function cancelDraftPeriod(page: Page, code: string) {
  const headers = { origin: new URL(page.url()).origin };
  const me = await page.request.get('/api/v1/auth/me', { headers });
  expect(me.ok(), await me.text()).toBe(true);
  const { agencyId } = (await me.json()) as { agencyId: string };
  const base = `/api/v1/agencies/${agencyId}/payroll-periods`;
  const list = await page.request.get(base, { headers });
  expect(list.ok(), await list.text()).toBe(true);
  const { periods } = (await list.json()) as {
    periods: Array<{ id: string; code: string; status: string; rowVersion: number }>;
  };
  const period = periods.find((row) => row.code === code && row.status === 'DRAFT');
  if (!period) return;
  const cancelled = await page.request.post(`${base}/${period.id}/cancel`, {
    headers,
    data: { reason: 'E2E cleanup', rowVersion: period.rowVersion },
  });
  expect(cancelled.ok(), await cancelled.text()).toBe(true);
}

async function openAs(page: Page, email: string, path: string) {
  await page.context().clearCookies();
  await signIn(page, email);
  await page.goto(path);
}

async function openCorrections(page: Page, email: string) {
  await openAs(page, email, '/payroll-corrections');
  await expect(page.getByRole('heading', { name: 'Payroll Corrections', level: 1 })).toBeVisible();
  return {
    adjustments: page.getByRole('region', { name: 'Payroll Adjustments' }),
    voids: page.getByRole('region', { name: 'Voids' }),
  };
}

async function openPayslips(page: Page, email: string, code: string) {
  await openAs(page, email, '/payslips');
  await expect(page.getByRole('heading', { name: 'Employee Payslips', level: 1 })).toBeVisible();
  const group = page.getByRole('region', { name: code, exact: true });
  await expect(group.getByRole('region', { name: `${code} approvals` })).toBeVisible();
  return group;
}

/** Choose an option of a select by the text it contains. */
async function chooseOption(select: Locator, text: string) {
  const value = await select.locator('option', { hasText: text }).getAttribute('value');
  await select.selectOption(value!);
}

async function createPeriod(
  page: Page,
  period: {
    code: string;
    runType: 'REGULAR' | 'SPECIAL';
    from: string;
    to: string;
    payment: string;
    supplemental?: boolean;
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
  if (period.supplemental) {
    await form.getByLabel('Carries open Payroll Adjustments (supplemental payroll)').check();
  }
  await form.getByRole('button', { name: 'Create period' }).click();
  await expect(page.getByText(`Payroll Period ${period.code} created in Draft.`)).toBeVisible();
  return page.getByRole('region', { name: period.code, exact: true });
}

const stageOf = (group: Locator, code: string) =>
  group.getByRole('list', { name: `${code} stage` });

test('takes a correction case on a finalized payroll to a finalized supplemental payroll', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const supplemental = `E2E-SUPPLEMENTAL-2850-${Date.now()}`;

  // The pending source correction is listed, and reads as pending.
  // Each locator is a query of the page, so it reads whichever page is open.
  const { adjustments } = await openCorrections(page, MARISOL_EMAIL);
  const alex = adjustments.getByRole('row').filter({ hasText: 'Alex Rivera' });
  await expect(alex).toContainText(ORIGINAL);
  await expect(alex).toContainText('Source correction');
  await expect(alex).toContainText('Correction key E2E-CORRECTION:LEAVE-CANCELLATION-2850-03-02');
  await expect(alex).toContainText('Not in a payroll yet');
  await expect(alex.getByText('Pending', { exact: true })).toBeVisible();

  // Payroll Preparer: opens a correction case by the Payroll Adjustment method for Alex Rivera,
  // which joins the adjustment the source correction opened.
  await page.getByRole('button', { name: 'Open correction' }).click();
  const form = page.getByRole('region', { name: 'Open correction' });
  await expect(form.getByLabel('Payroll Adjustment')).toBeChecked();
  await expect(form.getByLabel('Void and replace')).toHaveCount(0);
  await chooseOption(form.getByLabel('Finalized payroll'), ORIGINAL);
  await form
    .getByRole('combobox', { name: 'Employee', exact: true })
    .selectOption({ label: 'Alex Rivera · E2E-0001' });
  const reason = 'Leave approved the day after payroll; refund the day without pay.';
  await form.getByLabel('Reason').fill(reason);
  await form.getByRole('button', { name: 'Open Payroll Adjustment' }).click();
  await expect(
    page.getByText(
      `Joined the open Payroll Adjustment against ${ORIGINAL} for Alex Rivera. It stays pending until a payroll carries it.`,
    ),
  ).toBeVisible();
  await expect(alex).toContainText('Recalculation request');
  await expect(alex).toContainText(reason);
  await expect(alex).toContainText('Asked by Marisol Santos');
  await expect(alex.getByText('Pending', { exact: true })).toBeVisible();

  // The supplemental payroll: a special period that carries open Payroll Adjustments.
  await openAs(page, MARISOL_EMAIL, '/payslips');
  let group = await createPeriod(page, {
    code: supplemental,
    runType: 'SPECIAL',
    from: '2850-07-01',
    to: '2850-07-31',
    payment: '2850-07-31',
    supplemental: true,
  });
  await expect(group).toContainText('Open Payroll Adjustments (supplemental payroll)');
  await group.getByRole('button', { name: 'Start calculation' }).click();
  await expect(group.getByText('For review', { exact: true })).toBeVisible({
    timeout: CALCULATION_TIMEOUT,
  });
  const payslip = group
    .getByRole('region', { name: `${supplemental} payslips` })
    .getByRole('row')
    .filter({ hasText: 'Alex Rivera' });
  // A refunded deduction: Deductions -₱500.00 and Net pay ₱500.00.
  await expect(payslip.getByRole('cell', { name: '-₱500.00', exact: true })).toBeVisible();
  await expect(payslip.getByRole('cell', { name: '₱500.00', exact: true })).toBeVisible();
  await payslip.getByRole('button', { name: 'Alex Rivera' }).click();
  const computation = page
    .getByRole('region', { name: 'Alex Rivera' })
    .getByRole('region', { name: 'Salary Computation' });
  const line = computation.getByRole('row').filter({ hasText: 'Salary for days without pay' });
  await expect(line).toContainText('Payroll Adjustment for');
  await expect(line).toContainText('-₱500.00');

  await openCorrections(page, MARISOL_EMAIL);
  await expect(alex).toContainText(`In ${supplemental} (For review)`);
  await expect(alex.getByText('Pending', { exact: true })).toBeVisible();

  // The supplemental payroll's own review chain, one User per function.
  group = await openPayslips(page, CERTIFIER, supplemental);
  await group.getByRole('button', { name: `Certify HR inputs for ${supplemental}` }).click();
  let step = group.getByRole('form', { name: 'Certify HR inputs' });
  await step.getByRole('button', { name: 'Certify HR inputs' }).click();
  await expect(page.getByText(`${supplemental} certified.`)).toBeVisible();

  group = await openPayslips(page, BUDGET, supplemental);
  await group.getByRole('button', { name: `Record Budget review for ${supplemental}` }).click();
  step = group.getByRole('form', { name: 'Record Budget review' });
  await step.getByLabel('External reference').fill('ORS-2850-SUPP');
  await step.getByLabel('Evidence').selectOption({ label: 'E2E-PAYROLL-REVIEW-EVIDENCE · v1' });
  await step.getByRole('button', { name: 'Confirm Budget review' }).click();
  await expect(page.getByText(`Budget review of ${supplemental} confirmed.`)).toBeVisible();
  await expect(
    stageOf(group, supplemental).getByText('Reviewed 1/2', { exact: true }),
  ).toBeVisible();

  group = await openPayslips(page, ACCOUNTING, supplemental);
  await group.getByRole('button', { name: `Record Accounting review for ${supplemental}` }).click();
  step = group.getByRole('form', { name: 'Record Accounting review' });
  await step.getByLabel('External reference').fill('JEV-2850-SUPP');
  await step.getByLabel('Evidence Document Version ID').fill(EVIDENCE_VERSION_ID);
  await step.getByRole('button', { name: 'Confirm Accounting review' }).click();
  await expect(page.getByText(`Accounting review of ${supplemental} confirmed.`)).toBeVisible();

  group = await openPayslips(page, APPROVER, supplemental);
  await group.getByRole('button', { name: `Approve payroll for ${supplemental}` }).click();
  step = group.getByRole('form', { name: 'Approve payroll' });
  await step.getByRole('button', { name: 'Approve payroll' }).click();
  await expect(page.getByText(`${supplemental} approved.`)).toBeVisible();
  await group.getByRole('button', { name: `Finalize payroll for ${supplemental}` }).click();
  step = group.getByRole('form', { name: 'Finalize payroll' });
  await step.getByRole('button', { name: 'Finalize payroll' }).click();
  await expect(page.getByText(`${supplemental} finalized.`)).toBeVisible();
  await expect(stageOf(group, supplemental).locator('[aria-current="step"]')).toHaveText(
    'Finalized',
  );

  // The finalized supplemental payroll posted the adjustment; nothing is left pending.
  await openCorrections(page, MARISOL_EMAIL);
  await expect(adjustments.getByText('No pending Payroll Adjustment.')).toBeVisible();
  await adjustments.getByLabel('Show').selectOption('POSTED');
  await expect(alex.getByText('Posted', { exact: true })).toBeVisible();
  await expect(alex).toContainText(`Posted by ${supplemental}`);
  await alex.getByRole('link', { name: supplemental }).click();
  group = page.getByRole('region', { name: supplemental, exact: true });
  await expect(stageOf(group, supplemental).locator('[aria-current="step"]')).toHaveText(
    'Finalized',
  );
});

test('voids a finalized payroll, which stays readable and links to its replacement', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const replacement = `E2E-CORRECTION-2851-02-R-${Date.now()}`;
  draftRegularCode = replacement;
  const reason = 'The whole February payroll used the wrong salary schedule; no payment was made.';

  // Payroll Approver: requests the void, citing the supporting Document Version.
  const { voids } = await openCorrections(page, APPROVER);
  await expect(voids.getByText('No finalized payroll has a void requested or done.')).toBeVisible();
  await page.getByRole('button', { name: 'Open correction' }).click();
  const form = page.getByRole('region', { name: 'Open correction' });
  await expect(form.getByLabel('Payroll Adjustment')).toHaveCount(0);
  await form.getByLabel('Void and replace').check();
  await chooseOption(form.getByLabel('Finalized payroll'), TO_VOID);
  await form.getByLabel('Supporting Document Version ID').fill(EVIDENCE_VERSION_ID);
  await form.getByLabel('Reason').fill(reason);
  await form.getByRole('button', { name: 'Request void' }).click();
  await expect(
    page.getByText(
      `Void of ${TO_VOID} requested. It stays Finalized until the request is approved.`,
    ),
  ).toBeVisible();
  const row = voids.getByRole('row').filter({ hasText: TO_VOID });
  await expect(row).toContainText(reason);
  await expect(row.getByText('Void requested', { exact: true })).toBeVisible();

  // The requester cannot approve it: the API refuses, and the reason is shown.
  await row.getByRole('button', { name: `Approve void of ${TO_VOID}` }).click();
  await voids
    .getByRole('form', { name: `Approve void of ${TO_VOID}` })
    .getByRole('button', { name: 'Approve void' })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'a different person approves or declines it' }),
  ).toBeVisible();

  // A different Payroll Approver approves it.
  await openCorrections(page, VOID_APPROVER);
  await row.getByRole('button', { name: `Approve void of ${TO_VOID}` }).click();
  await voids
    .getByRole('form', { name: `Approve void of ${TO_VOID}` })
    .getByRole('button', { name: 'Approve void' })
    .click();
  await expect(page.getByText(`${TO_VOID} voided.`)).toBeVisible();
  await expect(row.getByText('Voided', { exact: true })).toBeVisible();

  // Payroll Preparer: the replacement is a new regular period for the same month.
  await openAs(page, MARISOL_EMAIL, '/payslips');
  await createPeriod(page, {
    code: replacement,
    runType: 'REGULAR',
    from: '2851-02-01',
    to: '2851-02-28',
    payment: '2851-02-28',
  });

  // The voided payroll stays readable, with its payslip, and links to its replacement.
  await openCorrections(page, MARISOL_EMAIL);
  await row.getByRole('link', { name: TO_VOID }).click();
  const voided = page.getByRole('region', { name: TO_VOID, exact: true });
  const correction = voided.getByRole('region', { name: `${TO_VOID} correction` });
  await expect(correction).toContainText(reason);
  await expect(
    voided
      .getByRole('region', { name: `${TO_VOID} payslips` })
      .getByRole('row')
      .filter({ hasText: 'Alex Rivera' })
      .getByText('Voided', { exact: true }),
  ).toBeVisible();
  await correction.getByRole('link', { name: replacement }).click();
  const replacing = page.getByRole('region', { name: replacement, exact: true });
  await expect(replacing.getByRole('region', { name: `${replacement} correction` })).toContainText(
    `Replaces the voided ${TO_VOID}.`,
  );
});
