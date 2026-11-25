import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { signIn } from './sign-in';

// The seed's Agency E2E-LEGACY-REGISTER holds Payroll Period E2E-LEGACY-2848-CLOTHING, Finalized,
// with one synthetic ₱1,000.00 clothing allowance line for each of E2E-LEGACY-0001 and
// E2E-LEGACY-0002. `legacy.preparer@` is its Payroll Preparer. Each seed run clears its
// comparisons. The amounts establish no rule.
const CODE = 'E2E-LEGACY-2848-CLOTHING';
const PREPARER = 'legacy.preparer@example.test';
// Repeated from seed-protected-shell-e2e.ts.
const PERIOD_ID = 'a9d00000-0000-4000-8000-000000000001';
// Says 1,200.00 for E2E-LEGACY-0001 and matches E2E-LEGACY-0002.
const register = resolve(__dirname, 'fixtures/legacy-register-2848.csv');
// Names an Employee number and a component code LingkodHR does not have.
const rejected = resolve(__dirname, 'fixtures/legacy-register-2848-rejected.csv');

test('rejects a register with its reasons, then reports both amounts of a difference', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.context().clearCookies();
  await signIn(page, PREPARER);
  await page.goto('/dashboard');
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await navigation.getByRole('button', { name: 'Payroll' }).click();
  await navigation.getByRole('link', { name: 'Legacy Register Comparisons' }).click();
  await expect(page).toHaveURL(/\/legacy-register-comparisons$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Legacy Register Comparisons' }),
  ).toBeVisible();

  // A rejected file shows each row's reason, and nothing is compared.
  await page.getByRole('button', { name: 'Compare legacy register' }).click();
  let form = page.getByRole('region', { name: 'Compare legacy register', exact: true });
  await form.getByLabel('Finalized Payroll Period').selectOption(PERIOD_ID);
  await form.getByLabel('Legacy register (CSV)').setInputFiles(rejected);
  await form.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('The legacy register was rejected');
  const reasons = form.getByRole('region', { name: 'Rejected rows' });
  await expect(reasons.getByRole('row').filter({ hasText: 'Line 2' })).toContainText(
    'No Employee of this Agency has the employee number E2E-LEGACY-0404.',
  );
  await expect(reasons.getByRole('row').filter({ hasText: 'Line 3' })).toContainText(
    'NOT_A_COMPONENT is not a pay component code.',
  );
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('No comparisons yet.')).toBeVisible();

  // The seeded register compares, and its one difference shows both amounts.
  await page.getByRole('button', { name: 'Compare legacy register' }).click();
  form = page.getByRole('region', { name: 'Compare legacy register', exact: true });
  await form.getByLabel('Finalized Payroll Period').selectOption(PERIOD_ID);
  await form.getByLabel('Legacy register (CSV)').setInputFiles(register);
  await form.getByRole('button', { name: 'Compare', exact: true }).click();

  const report = page.getByRole('region', { name: CODE, exact: true });
  await expect(report).toContainText('Rows compared');
  const differences = report.getByRole('region', { name: 'Differences' });
  const rows = differences.getByRole('row');
  await expect(rows).toHaveCount(2);
  const difference = rows.filter({ hasText: 'E2E-LEGACY-0001' });
  await expect(difference).toContainText('CLOTHING_ALLOWANCE');
  await expect(difference).toContainText('₱1,200.00');
  await expect(difference).toContainText('₱1,000.00');
  await expect(differences).not.toContainText('E2E-LEGACY-0002');

  // The list keeps it, and its form opens again from the list.
  await report.getByRole('button', { name: 'Close' }).click();
  const listed = page.getByRole('region', { name: 'Comparisons' }).getByRole('row', {
    name: new RegExp(CODE),
  });
  await listed.getByRole('button', { name: CODE }).click();
  await expect(
    page
      .getByRole('region', { name: CODE, exact: true })
      .getByRole('region', { name: 'Differences' })
      .getByRole('row')
      .filter({ hasText: 'E2E-LEGACY-0001' }),
  ).toContainText('₱1,200.00');
});
