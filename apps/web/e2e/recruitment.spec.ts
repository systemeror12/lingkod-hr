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
  test.setTimeout(180_000);
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

  await page.getByRole('button', { name: 'Applications' }).click();
  await page.getByRole('button', { name: 'New application' }).click();
  await page.getByLabel('First name').fill('Ana');
  await page.getByLabel('Last name').fill('Reyes');
  await page.getByLabel('Email').fill('ana.reyes@example.test');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Record Application' }).click();
  await expectStatus(page, 'RECEIVED');
  const applicationHeading = await page.getByRole('heading', { name: /APP-\d+/ }).textContent();
  const applicationNo = applicationHeading?.match(/APP-\d+/)?.[0];
  if (!applicationNo) throw new Error('The recorded Application number was not shown.');

  let linkedEvidence = 0;
  for (const [purpose, documentNo] of [
    ['EDUCATION', 'E2E-APPLICANT-EDUCATION'],
    ['ELIGIBILITY', 'E2E-APPLICANT-ELIGIBILITY'],
  ] as const) {
    await page.getByLabel('Purpose').selectOption(purpose);
    const option = page
      .getByLabel('Finalized Document Version')
      .locator('option')
      .filter({ hasText: documentNo });
    const documentVersionId = await option.getAttribute('value');
    if (!documentVersionId) throw new Error(`The ${documentNo} fixture was not available.`);
    await page.getByLabel('Finalized Document Version').selectOption(documentVersionId);
    await page.getByRole('button', { name: 'Link evidence' }).click();
    linkedEvidence += 1;
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(linkedEvidence);
  }

  await page.getByLabel('Education result').selectOption('MEETS');
  await page.getByLabel('Eligibility result').selectOption('MEETS');
  await page.getByRole('checkbox', { name: 'Education evidence E2E-APPLICANT-EDUCATION' }).check();
  await page
    .getByRole('checkbox', { name: 'Eligibility evidence E2E-APPLICANT-ELIGIBILITY' })
    .check();
  await page
    .getByLabel('Screening reason')
    .fill('Education and eligibility evidence satisfy the bound Qualification Standard Version.');
  await page.getByRole('button', { name: 'Record screening' }).click();
  await expectStatus(page, 'QUALIFIED');
  await expect(page.getByRole('button', { name: 'Record correction' })).toBeVisible();

  await page.getByLabel('Eligibility result').selectOption('DOES_NOT_MEET');
  await page
    .getByLabel('Correction reason')
    .fill('The eligibility certificate was issued after the application closing date.');
  await page.getByRole('button', { name: 'Record correction' }).click();
  await expectStatus(page, 'NOT_QUALIFIED');

  await page
    .getByLabel('Lifecycle reason')
    .fill('Notice and screening history handled for this Application.');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Close application' }).click();
  await expectStatus(page, 'CLOSED');

  await page.getByRole('button', { name: 'Kanban' }).click();
  await expect(page.getByRole('button', { name: new RegExp(applicationNo) })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ana Reyes/ })).toBeVisible();
  await page.getByRole('button', { name: 'Tree' }).click();
  await expect(page.getByRole('button', { name: applicationNo })).toBeVisible();
});
