import { expect, test, type Page } from '@playwright/test';
import { signIn } from './sign-in';

// The seed's Agency E2E-PAYSLIPS holds Payroll Period E2E-PAYSLIP-2849-CLOTHING, Finalized by
// `payslip.approver@` with two zero payslips Ready: E2E Payslip Owner's, whose User is
// `payslip.employee@`, and E2E Payslip Other's, whose User is `payslip.other@`. Its amounts
// establish no rule.
const CODE = 'E2E-PAYSLIP-2849-CLOTHING';
const APPROVER = 'payslip.approver@example.test';
const OWNER = 'payslip.employee@example.test';
const OTHER = 'payslip.other@example.test';
const OWNER_NAME = 'E2E Payslip Owner';
const OTHER_NAME = 'E2E Payslip Other';
// Repeated from seed-protected-shell-e2e.ts.
const PAYSLIP_ID = 'a9b00000-0000-4000-8000-000000000003';
const OTHER_PAYSLIP_ID = 'a9b00000-0000-4000-8000-000000000007';

async function openPeriodAsApprover(page: Page) {
  await page.context().clearCookies();
  await signIn(page, APPROVER);
  await page.goto('/payslips');
  await expect(page.getByRole('heading', { name: 'Employee Payslips', level: 1 })).toBeVisible();
  return page.getByRole('region', { name: CODE, exact: true });
}

/** The approver opens one payslip's form from the period and returns it. */
async function openPayslipForm(page: Page, group: ReturnType<Page['getByRole']>, name: string) {
  const payslips = group.getByRole('region', { name: `${CODE} payslips` });
  if (!(await payslips.isVisible())) {
    await group.getByRole('button', { name: `Expand ${CODE}` }).click();
  }
  await payslips.getByRole('button', { name }).click();
  return page.getByRole('region', { name, exact: true });
}

async function openMyPayslips(page: Page, email: string) {
  await page.context().clearCookies();
  await signIn(page, email);
  // A reused session signs in without leaving the page it was on.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible({ timeout: 15_000 });
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await navigation.getByRole('button', { name: 'Payroll' }).click();
  await navigation.getByRole('link', { name: 'My Payslips' }).click();
  await expect(page).toHaveURL(/\/my-payslips$/);
  await expect(page.getByRole('heading', { level: 1, name: 'My Payslips' })).toBeVisible();
  return page.getByRole('region', { name: 'Released payslips' });
}

test('withholds one seeded payslip, releases the other, and each opens only to its own Employee', async ({
  page,
}) => {
  test.setTimeout(240_000);

  // Before release, a Ready payslip is not the Employee's to read.
  let list = await openMyPayslips(page, OWNER);
  await expect(list.getByText('No released payslips yet.')).toBeVisible();

  // Payroll Approver: the collapsed, Finalized period offers releasing its Ready payslips.
  let group = await openPeriodAsApprover(page);
  await expect(group.getByRole('button', { name: `Expand ${CODE}` })).toBeVisible();
  const release = group.getByRole('button', { name: `Release payslips for ${CODE}` });
  await expect(release).toBeVisible();

  // Each payslip shows the server's status; the approver withholds one Ready payslip with a reason.
  let form = await openPayslipForm(page, group, OTHER_NAME);
  const status = form.getByRole('region', { name: 'Payslip status' });
  await expect(status).toContainText('Ready');
  await status.getByRole('button', { name: 'Withhold payslip' }).click();
  const withhold = status.getByRole('form', { name: 'Withhold payslip' });
  await withhold.getByLabel('Reason').fill('Held pending HRMO review of the clearance');
  await withhold.getByRole('button', { name: 'Withhold payslip' }).click();
  await expect(form.getByText(`Payslip of ${OTHER_NAME} withheld.`)).toBeVisible();
  await expect(status).toContainText('Withheld');
  await expect(status).toContainText('Held pending HRMO review of the clearance');
  await expect(status.getByRole('button', { name: 'Withhold payslip' })).toHaveCount(0);
  await form.getByRole('button', { name: 'Close' }).click();

  // The period's release takes the one still Ready.
  await release.click();
  const releaseForm = group.getByRole('form', { name: 'Release payslips' });
  await expect(releaseForm).toContainText('A payslip still generating stays unreleased');
  await releaseForm.getByRole('button', { name: 'Release payslips' }).click();
  await expect(page.getByText(`Released 1 payslip of ${CODE} to its Employee.`)).toBeVisible();
  // The period is read again before another User signs in; nothing is left Ready to release.
  const rows = group.getByRole('region', { name: `${CODE} payslips` }).getByRole('row');
  await expect(rows.filter({ hasText: OWNER_NAME })).toContainText('Released');
  await expect(rows.filter({ hasText: OTHER_NAME })).toContainText('Withheld');
  await expect(release).toHaveCount(0);

  // The Employee lists and opens their released payslip.
  list = await openMyPayslips(page, OWNER);
  const row = list.getByRole('row').filter({ hasText: CODE });
  await expect(row).toContainText('₱0.00');
  await row.getByRole('button', { name: CODE }).click();
  const payslip = page.getByRole('region', { name: CODE, exact: true });
  await expect(payslip).toContainText('Released');
  await expect(payslip).toContainText('Net pay');
  await expect(payslip.getByRole('region', { name: 'History' })).toContainText('Released to you');
  await expect(payslip.getByRole('link', { name: 'Open payslip PDF' })).toHaveAttribute(
    'href',
    /^https?:\/\//,
  );
  await payslip.getByRole('button', { name: 'Close' }).click();
  await expect(list).toBeVisible();

  // Another Employee neither lists it nor reads it by its ID, nor reads their own withheld one.
  list = await openMyPayslips(page, OTHER);
  await expect(list.getByText('No released payslips yet.')).toBeVisible();
  await expect(page.getByText(CODE)).toHaveCount(0);
  const origin = new URL(page.url()).origin;
  const me = await page.request.get('/api/v1/auth/me', { headers: { origin } });
  const { agencyId } = (await me.json()) as { agencyId: string };
  for (const id of [PAYSLIP_ID, OTHER_PAYSLIP_ID]) {
    const read = await page.request.get(`/api/v1/agencies/${agencyId}/payslips/${id}`, {
      headers: { origin },
    });
    expect(read.status(), id).toBe(404);
    expect(((await read.json()) as { error: { code: string } }).error.code).toBe(
      'PAYSLIP_NOT_FOUND',
    );
  }

  // The approver releases the withheld payslip with a reason; its Employee can then read it.
  group = await openPeriodAsApprover(page);
  form = await openPayslipForm(page, group, OTHER_NAME);
  const withheld = form.getByRole('region', { name: 'Payslip status' });
  await withheld.getByRole('button', { name: 'Release withheld payslip' }).click();
  const releaseWithheld = withheld.getByRole('form', { name: 'Release withheld payslip' });
  await releaseWithheld.getByLabel('Reason').fill('HRMO review cleared');
  await releaseWithheld.getByRole('button', { name: 'Release withheld payslip' }).click();
  await expect(form.getByText(`Withheld payslip of ${OTHER_NAME} released`)).toBeVisible();
  await expect(withheld).toContainText('Released');
  await form.getByRole('button', { name: 'Close' }).click();
  await expect(group.getByRole('region', { name: `${CODE} payslips` })).toBeVisible();

  list = await openMyPayslips(page, OTHER);
  await expect(list.getByRole('row').filter({ hasText: CODE })).toBeVisible();
});
