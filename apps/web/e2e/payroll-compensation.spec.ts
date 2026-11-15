import { expect, test } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

// The seed loads synthetic rule versions in effect only in 2850 (seedSyntheticRuleVersions):
// schedule B supersedes A from 1 July 2850. Their amounts are fixtures, not rates.
const SCHEDULE_A = 'E2E-SYNTHETIC-SCHEDULE-2850-A';
const SCHEDULE_B = 'E2E-SYNTHETIC-SCHEDULE-2850-B';
const DEDUCTIONS = 'E2E-SYNTHETIC-DEDUCTIONS-2850';
// The seeded Context Reader holds only the Payroll Preparer role: it reads compensation but
// cannot manage Agency Payroll Applicability or read Employees.
const READER_EMAIL = 'context.reader@example.test';

test('lists, opens, and compares National Payroll Rule Versions', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, MARISOL_EMAIL);
  await page.goto('/salary-rules');
  await expect(page.getByRole('heading', { name: 'Salary Rules', level: 1 })).toBeVisible();

  const rowA = page.getByRole('row', { name: new RegExp(`^${SCHEDULE_A} `) });
  await expect(rowA).toContainText('Jan 1, 2850 to Dec 31, 2850');
  await expect(rowA).toContainText('LingkodHR E2E fixture, not an authority');
  await expect(rowA.getByText('Superseded from Jul 1, 2850')).toBeVisible();
  await expect(rowA).toContainText(`by ${SCHEDULE_B}`);
  await expect(page.getByRole('row', { name: new RegExp(`^${SCHEDULE_B} `) })).toContainText(
    `supersedes ${SCHEDULE_A}`,
  );

  await rowA.getByRole('button', { name: SCHEDULE_A }).click();
  const version = page.getByRole('region', { name: SCHEDULE_A });
  await expect(version.getByText('Synthetic E2E fixture, not an issuance')).toBeVisible();
  await expect(version.getByRole('button', { name: SCHEDULE_B })).toBeVisible();
  const rates = version.getByRole('region', { name: 'Salary Grade rates' });
  await expect(rates.getByRole('row').filter({ hasText: '2400' })).toContainText('24');

  await version
    .getByLabel('Compare with')
    .selectOption({ label: `${SCHEDULE_B} · Jul 1, 2850 to Dec 31, 2850` });
  const comparison = version.getByRole('table', { name: 'Rate comparison' });
  await expect(
    comparison.getByRole('row').filter({ hasText: '2400' }).filter({ hasText: '2450' }),
  ).toContainText('Differs');
  await expect(comparison.getByRole('row').filter({ hasText: '2410' })).toContainText('Same');
  await expect(version.getByRole('table', { name: 'Version comparison' })).toContainText(
    'Jul 1, 2850 to Dec 31, 2850',
  );

  // The successor opens from its predecessor's form.
  await version.getByRole('button', { name: SCHEDULE_B }).click();
  const successor = page.getByRole('region', { name: SCHEDULE_B });
  await expect(successor.getByRole('button', { name: SCHEDULE_A })).toBeVisible();
  await expect(successor.getByText('Not superseded', { exact: true }).first()).toBeVisible();
  await successor.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: DEDUCTIONS }).click();
  const deductions = page.getByRole('region', { name: DEDUCTIONS });
  await expect(deductions.getByRole('list', { name: 'Allowed payee categories' })).toContainText(
    'GSIS',
  );
});

test('records and ends Agency Payroll Applicability, read-only to others', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const funding = `E2E allotment ${Date.now()}`;
  await signIn(page, MARISOL_EMAIL);
  await page.goto('/payroll-applicability');
  await expect(
    page.getByRole('heading', { name: 'Payroll Applicability', level: 1 }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Record applicability' }).click();
  const form = page.getByRole('region', { name: 'Record Agency Payroll Applicability' });
  await form
    .getByLabel('Pay component')
    .selectOption({ label: 'E2E synthetic authorized component (E2E-AUTHORIZED-COMPONENT)' });
  await form.getByLabel('Applies to').selectOption('EMPLOYEE');
  await form.getByLabel(/^Employee/).selectOption({ label: 'E2E-0001 · Alex Rivera' });
  await form.getByLabel('Authority document').selectOption({ label: 'E2E-PAYROLL-AUTHORITY · v1' });
  await form.getByLabel('Funding reference').fill(funding);
  await form.getByLabel('Effective from').fill('2850-01-01');
  await form.getByLabel('Effective to (optional)').fill('2850-12-31');
  await form.getByRole('button', { name: 'Record applicability' }).click();

  const recorded = page.getByRole('region', { name: 'E2E synthetic authorized component' });
  await expect(recorded.getByRole('status')).toHaveText('Recorded.');
  await expect(recorded).toContainText('Jan 1, 2850 to Dec 31, 2850');
  await expect(recorded).toContainText('Alex Rivera');

  // The API refuses an end that does not bring the end forward, and the form shows its reason.
  await recorded.getByLabel('Last effective date').fill('2851-01-31');
  await recorded.getByLabel('Reason').fill('Funding withdrawn');
  await recorded.getByRole('button', { name: 'End record' }).click();
  await expect(recorded.getByRole('alert')).toContainText('bringing its end forward');

  await recorded.getByLabel('Last effective date').fill('2850-06-30');
  await recorded.getByRole('button', { name: 'End record' }).click();
  await expect(recorded.getByRole('status')).toHaveText('Ended.');
  await expect(recorded).toContainText('Jan 1, 2850 to Jun 30, 2850');
  await recorded.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('row').filter({ hasText: funding })).toContainText(
    'Jan 1, 2850 to Jun 30, 2850',
  );

  const readerContext = await browser.newContext();
  const reader = await readerContext.newPage();
  await signIn(reader, READER_EMAIL);
  await reader.goto('/payroll-applicability');
  await expect(reader.getByRole('button', { name: 'Record applicability' })).toHaveCount(0);
  const row = reader.getByRole('row').filter({ hasText: funding });
  await row.getByRole('button', { name: 'E2E synthetic authorized component' }).click();
  const readOnly = reader.getByRole('region', { name: 'E2E synthetic authorized component' });
  await expect(readOnly).toContainText('Read-only.');
  await expect(readOnly).toContainText('Jan 1, 2850 to Jun 30, 2850');
  await expect(readOnly.getByRole('button', { name: 'End record' })).toHaveCount(0);
  await readerContext.close();
});

test('shows a seeded Employee’s compensation basis with its sources and reasons', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page, MARISOL_EMAIL);
  await page.goto('/compensation');
  await expect(page.getByRole('heading', { name: 'Compensation', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Alex Rivera' }).click();
  const panel = page.getByRole('region', { name: 'Alex Rivera' });
  await panel.getByLabel('From', { exact: true }).fill('2850-06-01');
  await panel.getByLabel('To', { exact: true }).fill('2850-07-31');
  await panel.getByRole('button', { name: 'Show basis' }).click();

  // Personnel records no pay basis yet, so every stretch is indeterminate and says why.
  await expect(panel.getByText('Indeterminate', { exact: true }).first()).toBeVisible();
  const june = panel.getByRole('region', { name: 'Jun 1, 2850 to Jun 30, 2850' });
  const july = panel.getByRole('region', { name: 'Jul 1, 2850 to Jul 31, 2850' });
  for (const [stretch, schedule] of [
    [june, SCHEDULE_A],
    [july, SCHEDULE_B],
  ] as const) {
    const source = stretch.getByRole('region', { name: 'Salary schedule' });
    await expect(source.getByRole('link', { name: schedule })).toBeVisible();
    await expect(stretch.getByRole('region', { name: 'Personnel Service Segment' })).toContainText(
      'Not recorded',
    );
    await expect(stretch.getByRole('region', { name: 'Why it is indeterminate' })).toContainText(
      'Personnel records no pay basis for the Service Segment.',
    );
  }

  // A schedule source opens to its rule version.
  await july.getByRole('link', { name: SCHEDULE_B }).click();
  await expect(page).toHaveURL(/\/salary-rules\?version=/);
  await expect(page.getByRole('region', { name: SCHEDULE_B })).toBeVisible();
});
