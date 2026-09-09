import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

function resetFixture(): void {
  execFileSync('pnpm', ['--filter', '@lingkod-hr/database', 'e2e:seed:shell'], {
    cwd: resolve(__dirname, '../../..'),
    env: { ...process.env },
    stdio: 'pipe',
  });
}

async function expectStatus(page: Page, status: string): Promise<void> {
  await expect(page.getByText(status.replaceAll('_', ' '), { exact: true }).first()).toBeVisible();
}

test('drives the protected Request to Fill and publication journey', async ({ page }) => {
  test.setTimeout(120_000);
  resetFixture();

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/recruitment');
  await expect(page.getByRole('heading', { name: 'Recruitment' })).toBeVisible();

  await page.getByRole('button', { name: 'New request to fill' }).click();
  const vacancyOption = page
    .getByLabel('Recruitable Vacancy')
    .locator('option')
    .filter({ hasText: 'HRM-000143' });
  const vacancyId = await vacancyOption.getAttribute('value');
  if (!vacancyId) throw new Error('The seeded Recruitable Vacancy was not available.');
  await page.getByLabel('Recruitable Vacancy').selectOption(vacancyId);
  await page
    .getByLabel('Justification')
    .fill('Fill the authorized Plantilla vacancy for HR service continuity.');
  await page.getByRole('button', { name: 'Open draft request' }).click();
  await expectStatus(page, 'DRAFT');

  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expectStatus(page, 'SUBMITTED');
  await page.getByRole('button', { name: 'Begin controlled review' }).click();
  await expectStatus(page, 'FOR_REVIEW');
  await page.getByRole('button', { name: 'Approve request' }).click();
  await expectStatus(page, 'APPROVED');

  await page.getByRole('button', { name: 'Vacancy Publications' }).click();
  await page.getByRole('button', { name: 'New publication' }).click();
  await page.getByLabel('Exact CS Form No. 9 Document Version').selectOption({ index: 1 });
  await page.getByLabel('HR contact name').fill('Marisol Santos');
  await page.getByLabel('HR contact email').fill('marisol.santos@example.test');
  await page
    .getByLabel('HRMO certification')
    .fill('The posting package was checked against the approved vacancy.');
  await page.getByRole('button', { name: 'Prepare draft publication' }).click();
  await expectStatus(page, 'DRAFT');

  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expectStatus(page, 'FOR_APPROVAL');
  await page.getByRole('button', { name: 'Approve and publish' }).click();
  await expectStatus(page, 'PUBLISHED');

  await page.getByLabel('Transition reason').fill('The declared posting period has ended.');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Close publication' }).click();
  await expectStatus(page, 'CLOSED');

  await page.getByRole('button', { name: 'Prepare republication' }).click();
  await page.getByLabel('Exact CS Form No. 9 Document Version').selectOption({ index: 1 });
  await page.getByLabel('HR contact name').fill('Marisol Santos');
  await page.getByLabel('HR contact email').fill('marisol.santos@example.test');
  await page
    .getByLabel('HRMO certification')
    .fill('The corrected posting package was checked and reissued.');
  await page
    .getByLabel('Republication basis')
    .fill('Approved correction to the original posting package.');
  await page.getByLabel('Republication authority document version').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Prepare linked republication' }).click();
  await expectStatus(page, 'DRAFT');

  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expectStatus(page, 'FOR_APPROVAL');
  await page.getByRole('button', { name: 'Approve and publish' }).click();
  await expectStatus(page, 'PUBLISHED');
  await expect(page.getByText(/Republication of/)).toBeVisible();
});
