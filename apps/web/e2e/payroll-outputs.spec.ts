import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signIn } from './sign-in';

// The seed's Agency E2E-PAYROLL-OUTPUTS holds one Finalized period, certified at its results'
// hash, that pays E2E Outputs Payee 1,000.00. `payroll.outputs@` is its Accounting Reviewer, who
// holds every output's permission. Each seed run removes the outputs generated before. Its
// amounts establish no rule.
const CODE = 'E2E-OUTPUTS-2847-CLOTHING';
const REVIEWER = 'payroll.outputs@example.test';
// Repeated from seed-protected-shell-e2e.ts.
const AGENCY_ID = 'a9647000-0000-4000-8000-0000000000a0';
const PERIOD_ID = 'a9647000-0000-4000-8000-000000000001';

test('generates and downloads the register and a schedule of a Finalized payroll', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, REVIEWER);
  await page.goto('/dashboard');
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await navigation.getByRole('button', { name: 'Payroll' }).click();
  await navigation.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/payroll-reports$/);
  await page.getByLabel('Payroll Period').selectOption({ label: CODE });
  const outputs = page.getByRole('region', { name: `${CODE} outputs` });

  // The register: generated on request, it says when and from which payroll.
  const register = outputs.getByRole('row', { name: /Payroll Register/ });
  await expect(register).toContainText('Not generated');
  await register.getByRole('button', { name: 'Generate register' }).click();
  await expect(register).toContainText('Ready');
  await expect(register).toContainText('1 result · Gross ₱1,000.00 · Net ₱1,000.00');
  await expect(register).toContainText(
    new RegExp(`Generated .+ from ${CODE}, calculation version 1`),
  );

  // Its PDF opens through a short-lived link; the bytes are the issued register.
  await register.getByRole('button', { name: 'Prepare register PDF' }).click();
  const link = register.getByRole('link', { name: 'Open register PDF' });
  await expect(link).toBeVisible();
  const pdf = await page.request.get((await link.getAttribute('href'))!);
  expect(pdf.ok()).toBe(true);
  const body = (await pdf.body()).toString('latin1');
  expect(body.startsWith('%PDF-')).toBe(true);
  expect(body).toContain('(PAYROLL REGISTER) Tj');
  expect(body).toContain(`(Payroll Period: ${CODE}`);

  // The schedules: one generation makes all three; the Tax Summary downloads as its exact bytes.
  const schedules = outputs.getByRole('row', { name: /deduction schedules/ });
  await schedules.getByRole('button', { name: 'Generate schedules' }).click();
  await expect(schedules).toContainText('Ready');
  await expect(schedules).toContainText(
    new RegExp(`Generated .+ from ${CODE}, calculation version 1`),
  );
  const download = page.waitForEvent('download');
  await schedules.getByRole('link', { name: 'Download Tax Summary' }).click();
  const taxSummary = await download;
  expect(taxSummary.suggestedFilename()).toBe(`deduction-summaries-${CODE}-tax-summary-v1.json`);
  const saved = readFileSync((await taxSummary.path())!);
  expect(saved.toString('utf8')).toContain(CODE);
  const stored = await page.request.get(
    `/api/v1/agencies/${AGENCY_ID}/payroll-periods/${PERIOD_ID}/deduction-summaries`,
    { headers: { origin: new URL(page.url()).origin } },
  );
  const { deductionSummaries } = (await stored.json()) as {
    deductionSummaries: { taxSummary: { checksum: string } };
  };
  expect(createHash('sha256').update(saved).digest('hex')).toBe(
    deductionSummaries.taxSummary.checksum,
  );

  // Read again, the generated outputs are Ready with the same provenance; the rest are not.
  await page.reload();
  await page.getByLabel('Payroll Period').selectOption({ label: CODE });
  await expect(register).toContainText('Ready');
  await expect(schedules).toContainText('Ready');
  await expect(outputs.getByRole('row', { name: /Variance and Exception Report/ })).toContainText(
    'Not generated',
  );
  await expect(outputs.getByRole('row', { name: /Accounting Support Export/ })).toContainText(
    'Not generated',
  );
});
