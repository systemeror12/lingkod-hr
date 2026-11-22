import { expect, test, type Page } from '@playwright/test';
import { signIn } from './sign-in';

// The seed's Payroll Period E2E-REVIEW-2850-CLOTHING waits For review with Alex Rivera's one zero
// payslip, prepared by Marisol Santos. One seeded User holds each review function, so the
// one-function rule (#330) never stops this flow. Its amounts establish no rule.
const CODE = 'E2E-REVIEW-2850-CLOTHING';
const CERTIFIER = 'payroll.certifier@example.test';
const BUDGET = 'payroll.budget@example.test';
const ACCOUNTING = 'payroll.accounting@example.test';
const APPROVER = 'payroll.approver@example.test';
// Repeated from seed-protected-shell-e2e.ts: the Accounting Reviewer cannot list Document
// Versions, so they type the one their evidence is.
const EVIDENCE_VERSION_ID = 'a9a00000-0000-4000-8000-000000000003';

async function openAs(page: Page, email: string) {
  await page.context().clearCookies();
  await signIn(page, email);
  await page.goto('/payslips');
  await expect(page.getByRole('heading', { name: 'Employee Payslips', level: 1 })).toBeVisible();
  const group = page.getByRole('region', { name: CODE, exact: true });
  await expect(group.getByRole('region', { name: `${CODE} approvals` })).toBeVisible();
  return group;
}

const stageOf = (group: ReturnType<Page['getByRole']>) =>
  group.getByRole('list', { name: `${CODE} stage` });
const step = (group: ReturnType<Page['getByRole']>, name: string) =>
  group.getByRole('region', { name: `${CODE} approvals` }).locator(`[data-step="${name}"]`);

test('takes the seeded payroll from For review to Finalized, one User per review function', async ({
  page,
}) => {
  test.setTimeout(300_000);

  // HR Certifier: certifies the calculated version. A second tab, still showing For review,
  // is refused with the API's reason.
  let group = await openAs(page, CERTIFIER);
  await expect(stageOf(group).locator('[aria-current="step"]')).toHaveText('Calculated');
  await expect(step(group, 'Certified')).toContainText('Pending');
  await expect(group.getByRole('button', { name: /^Record .* review$/ })).toHaveCount(0);
  await expect(group.getByRole('button', { name: 'Approve payroll' })).toHaveCount(0);
  const staleTab = await page.context().newPage();
  await staleTab.goto('/payslips');
  const staleGroup = staleTab.getByRole('region', { name: CODE, exact: true });
  await expect(staleGroup.getByRole('region', { name: `${CODE} approvals` })).toBeVisible();

  await group.getByRole('button', { name: `Certify HR inputs for ${CODE}` }).click();
  let form = group.getByRole('form', { name: 'Certify HR inputs' });
  await expect(form).toContainText('Certifies calculation version 1');
  await form.getByRole('button', { name: 'Certify HR inputs' }).click();
  await expect(page.getByText(`${CODE} certified.`)).toBeVisible();
  await expect(stageOf(group).locator('[aria-current="step"]')).toHaveText('Certified');
  await expect(step(group, 'Certified')).toContainText('Celia Navarro');
  await expect(step(group, 'Certified')).toContainText('Calculation version 1');

  await staleGroup.getByRole('button', { name: `Certify HR inputs for ${CODE}` }).click();
  form = staleGroup.getByRole('form', { name: 'Certify HR inputs' });
  await form.getByRole('button', { name: 'Certify HR inputs' }).click();
  await expect(
    form.getByText(/The Payroll Period is CERTIFIED; this command applies only/),
  ).toBeVisible();
  await staleTab.close();

  // Budget Officer: confirms funding with evidence chosen from the Agency's Document Versions.
  group = await openAs(page, BUDGET);
  await expect(group.getByRole('button', { name: 'Record Accounting review' })).toHaveCount(0);
  await expect(group.getByRole('button', { name: 'Approve payroll' })).toHaveCount(0);
  await group.getByRole('button', { name: `Record Budget review for ${CODE}` }).click();
  form = group.getByRole('form', { name: 'Record Budget review' });
  await form.getByLabel('External reference').fill('ORS-2850-0001');
  await form.getByLabel('Evidence').selectOption({ label: 'E2E-PAYROLL-REVIEW-EVIDENCE · v1' });
  await form.getByRole('button', { name: 'Confirm Budget review' }).click();
  await expect(page.getByText(`Budget review of ${CODE} confirmed.`)).toBeVisible();
  // One checkpoint is pending, never complete.
  await expect(stageOf(group).getByText('Reviewed 1/2', { exact: true })).toBeVisible();
  await expect(stageOf(group).locator('[aria-current="step"]')).toHaveText('Certified');
  await expect(step(group, 'Budget review')).toContainText('Bernardo Lim');
  await expect(step(group, 'Budget review')).toContainText('Confirmed · ORS-2850-0001');
  await expect(step(group, 'Accounting review')).toContainText('Pending');

  // Accounting Reviewer: confirms the accounts.
  group = await openAs(page, ACCOUNTING);
  await expect(group.getByRole('button', { name: 'Record Budget review' })).toHaveCount(0);
  await group.getByRole('button', { name: `Record Accounting review for ${CODE}` }).click();
  form = group.getByRole('form', { name: 'Record Accounting review' });
  await form.getByLabel('External reference').fill('JEV-2850-0001');
  await form.getByLabel('Evidence Document Version ID').fill(EVIDENCE_VERSION_ID);
  await form.getByRole('button', { name: 'Confirm Accounting review' }).click();
  await expect(page.getByText(`Accounting review of ${CODE} confirmed.`)).toBeVisible();
  await expect(stageOf(group).locator('[aria-current="step"]')).toHaveText('Reviewed');
  await expect(step(group, 'Accounting review')).toContainText('Aurora Bautista');
  await expect(step(group, 'Approved')).toContainText('Pending');

  // Payroll Approver: approves, then finalizes.
  group = await openAs(page, APPROVER);
  await expect(group.getByRole('button', { name: 'Finalize payroll' })).toHaveCount(0);
  await group.getByRole('button', { name: `Approve payroll for ${CODE}` }).click();
  form = group.getByRole('form', { name: 'Approve payroll' });
  await form.getByRole('button', { name: 'Approve payroll' }).click();
  await expect(page.getByText(`${CODE} approved.`)).toBeVisible();
  await expect(stageOf(group).locator('[aria-current="step"]')).toHaveText('Approved');
  await expect(step(group, 'Approved')).toContainText('Paolo Mendoza');
  await expect(step(group, 'Finalized')).toContainText('Pending');
  await expect(group.getByRole('button', { name: 'Approve payroll' })).toHaveCount(0);

  await group.getByRole('button', { name: `Finalize payroll for ${CODE}` }).click();
  form = group.getByRole('form', { name: 'Finalize payroll' });
  await expect(form).toContainText('It marks no one paid.');
  await form.getByRole('button', { name: 'Finalize payroll' }).click();
  await expect(page.getByText(`${CODE} finalized.`)).toBeVisible();
  await expect(group.getByText('Finalized', { exact: true }).first()).toBeVisible();
  await expect(stageOf(group).locator('[aria-current="step"]')).toHaveText('Finalized');
  await expect(step(group, 'Finalized')).toContainText('Paolo Mendoza');
  // No review command is left. Releasing payslips appears only once one is generated and Ready,
  // which the background generation decides, so it is not asserted here.
  await expect(
    group.getByRole('button', {
      name: /^(Certify|Return|Revoke|Record|Approve|Finalize) /,
    }),
  ).toHaveCount(0);

  // Each step stays its own, with who took it.
  for (const [name, by] of [
    ['Certified', 'Celia Navarro'],
    ['Budget review', 'Bernardo Lim'],
    ['Accounting review', 'Aurora Bautista'],
    ['Approved', 'Paolo Mendoza'],
    ['Finalized', 'Paolo Mendoza'],
  ] as const) {
    await expect(step(group, name), name).toContainText(by);
    await expect(step(group, name), name).not.toContainText('Pending');
  }
});
