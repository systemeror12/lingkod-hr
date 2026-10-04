import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

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

async function selectEvidence(page: Page, documentNo: string): Promise<void> {
  const option = page
    .getByLabel('Finalized Document Version')
    .locator('option')
    .filter({ hasText: documentNo });
  const documentVersionId = await option.getAttribute('value');
  if (!documentVersionId) throw new Error(`The ${documentNo} fixture was not available.`);
  await page.getByLabel('Finalized Document Version').selectOption(documentVersionId);
}

async function selectOptionByText(page: Page, label: string, text: string): Promise<void> {
  const option = page.getByLabel(label).locator('option').filter({ hasText: text }).first();
  const value = await option.getAttribute('value');
  if (!value) throw new Error(`The ${text} fixture was not available for ${label}.`);
  await page.getByLabel(label).selectOption(value);
}

test('drives the protected Request to Fill and publication journey', async ({ page }) => {
  test.setTimeout(240_000);
  resetFixture();

  await signIn(page, MARISOL_EMAIL);
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

  await page.getByRole('link', { name: 'Vacancy Publications', exact: true }).click();
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

  await page.getByRole('link', { name: 'Applications', exact: true }).click();
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
    await selectEvidence(page, documentNo);
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

  await expect(page.getByRole('heading', { name: 'Merit selection stages' })).toBeVisible();
  await page.getByLabel('Assessment scheduled at').fill('2026-09-20T09:00');
  await page.getByRole('button', { name: 'Schedule assessment' }).click();
  await expectStatus(page, 'FOR_ASSESSMENT');

  await page.getByRole('button', { name: 'Record assessment result' }).click();
  await page.getByLabel('Criterion').selectOption('JOB_KNOWLEDGE');
  await page.getByLabel('Score').fill('85');
  await page.getByRole('button', { name: 'Save assessment result' }).click();

  await page.getByRole('button', { name: 'Record assessment result' }).click();
  await page.getByLabel('Criterion').selectOption('DOCUMENTATION');
  await page.getByLabel('Rating').selectOption('SATISFACTORY');
  const resultEvidenceOption = page
    .getByLabel('Result evidence document version')
    .locator('option')
    .filter({ hasText: 'E2E-APPLICANT-EDUCATION' });
  const resultEvidenceId = await resultEvidenceOption.getAttribute('value');
  if (!resultEvidenceId) throw new Error('The assessment evidence fixture was not available.');
  await page.getByLabel('Result evidence document version').selectOption(resultEvidenceId);
  await page.getByRole('button', { name: 'Save assessment result' }).click();
  await expect(page.getByText('74.50')).toBeVisible();

  await page.getByRole('button', { name: 'Complete assessment' }).click();
  await expectStatus(page, 'COMPLETED');

  await page.getByLabel('Interview scheduled at').fill('2026-09-21T09:00');
  await page.getByRole('button', { name: 'Schedule interview' }).click();
  await expectStatus(page, 'FOR_INTERVIEW');

  await page.getByRole('button', { name: 'Record interview feedback' }).click();
  await page.getByLabel('Feedback score').fill('80');
  await page
    .getByLabel('Feedback comments')
    .fill('The panel recommends the applicant for the vacancy.');
  await page.getByRole('button', { name: 'Submit feedback' }).click();
  await expect(page.getByText('80.00')).toBeVisible();
  await page.getByRole('button', { name: 'Complete interview' }).click();
  await expectStatus(page, 'COMPLETED');

  await page.getByRole('button', { name: 'Correct result' }).first().click();
  await expect(page.getByLabel('Criterion')).toHaveValue('JOB_KNOWLEDGE');
  await page.getByLabel('Score').fill('90');
  await page
    .getByLabel('Correction reason')
    .fill('The answer sheet was scored against the wrong key.');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByText('78.00')).toBeVisible();
  await expect(
    page.getByText(/correction: The answer sheet was scored against the wrong key/),
  ).toBeVisible();

  await page.getByRole('button', { name: 'New application' }).click();
  await page.getByLabel('First name').fill('Bea');
  await page.getByLabel('Last name').fill('Cruz');
  await page.getByLabel('Email').fill('bea.cruz@example.test');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Record Application' }).click();
  await expectStatus(page, 'RECEIVED');

  await page.getByLabel('Purpose').selectOption('EDUCATION');
  await selectEvidence(page, 'E2E-APPLICANT-EDUCATION');
  await page.getByRole('button', { name: 'Link evidence' }).click();
  await page.getByLabel('Purpose').selectOption('ELIGIBILITY');
  await selectEvidence(page, 'E2E-APPLICANT-ELIGIBILITY');
  await page.getByRole('button', { name: 'Link evidence' }).click();

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
  await expect(page.getByLabel('Eligibility result')).toHaveValue('DOES_NOT_MEET');
  await page
    .getByLabel('Correction reason')
    .fill('The eligibility certificate was issued after the application closing date.');
  await expect(page.getByText('Recorded outcome: NOT QUALIFIED').first()).toBeVisible();
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
  await expect(page.getByRole('button', { name: /Bea Cruz/ })).toBeVisible();
  await page.getByRole('button', { name: 'Tree' }).click();
  await expect(page.getByRole('button', { name: applicationNo })).toBeVisible();
});

test('drives HRMPSB deliberation, the advisory report, and the Selection Decision', async ({
  page,
}) => {
  test.setTimeout(240_000);
  resetFixture();

  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/recruitment');
  await expect(page.getByRole('heading', { name: 'Recruitment' })).toBeVisible();

  // The seeded publication period has elapsed and screening is complete.
  await page.getByRole('link', { name: 'HRMPSB Sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Convene HRMPSB Session' }).click();
  await selectOptionByText(page, 'Published vacancy', 'HRM-000144');
  await page.getByRole('button', { name: 'Convene Session' }).click();
  await expectStatus(page, 'DRAFT');
  await expect(page.getByRole('heading', { name: /HRMPSB Session/ })).toBeVisible();

  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('PRESENT', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start deliberation' }).click();
  await expect(page.getByText(/quorum satisfied/)).toBeVisible();
  await expect(page.getByText(/national floor 1 of 1 voting seats/)).toBeVisible();

  await page.getByLabel('Board reason').fill('The Board recommends the highest-ranked applicant.');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/Board Recommendation: RECOMMENDED/)).toBeVisible();

  await selectOptionByText(page, 'Evaluation report Document Version', 'E2E-CS-FORM-9');
  await page.getByRole('button', { name: 'Issue report' }).click();
  await expect(page.getByText(/^v1 ·/).first()).toBeVisible();
  await selectOptionByText(page, 'Minutes Document Version', 'E2E-CS-FORM-9');
  await page.getByRole('button', { name: 'Complete deliberation' }).click();
  await expectStatus(page, 'COMPLETED');

  // The appointing authority records the separate Selection Decision.
  await page.getByRole('button', { name: 'Tree' }).click();
  await expect(page.getByRole('heading', { name: 'HRMPSB Sessions' })).toBeVisible();
  await page.getByRole('link', { name: 'Applications', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
  await page
    .getByRole('button', { name: /APP-\d+/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'HRMPSB deliberation' })).toBeVisible();
  await expect(page.getByText(/Board Recommendation: RECOMMENDED/)).toBeVisible();
  await page.getByLabel('Decision').selectOption('SELECTED');
  await page
    .getByLabel('Recorded basis')
    .fill('The appointing authority selects the recommended applicant.');
  await selectOptionByText(page, 'Appointing authority evidence', 'E2E-CS-FORM-9');
  await page.getByRole('button', { name: 'Record Selection Decision' }).click();
  await expectStatus(page, 'SELECTED');

  await page.getByRole('button', { name: 'Tree' }).click();
  await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
  await page.getByRole('link', { name: 'Selection Decisions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Selection Decisions' })).toBeVisible();
  await page
    .getByRole('button', { name: /APP-\d+/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Preview selected-candidate package' }).click();
  await expect(page.getByText(/selectionDecisionId/)).toBeVisible();
  await expect(page.getByText(/reserved through Plantilla/)).toBeVisible();
});
