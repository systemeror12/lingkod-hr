import { expect, test } from '@playwright/test';

test('prepares, reviews, issues, corrects, and cancels an Appointment', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/appointments');
  await expect(page.getByRole('heading', { name: 'Appointments', exact: true })).toBeVisible();

  const eligible = page.getByRole('region', { name: 'Eligible selections' });
  await expect(eligible.getByText('Appointment Candidate')).toBeVisible();
  await eligible.getByRole('button', { name: 'Prepare Appointment' }).click();

  const prepare = page.getByRole('region', { name: 'Prepare Appointment' });
  await expect(prepare.getByLabel('Appointment form (finalized Document Version)')).not.toHaveValue(
    '',
  );
  await prepare.getByRole('button', { name: 'Prepare Draft' }).click();

  const detail = page.getByRole('region', { name: 'Appointment Candidate' });
  await expect(detail.getByLabel('Workflow status')).toContainText('DRAFT');
  await expect(detail.getByLabel('Version v1')).toContainText('DRAFT');
  await expect(detail.getByLabel('Version v1').getByText('PDS', { exact: true })).toBeVisible();
  await expect(
    detail.getByLabel('Version v1').getByText('WORK EXPERIENCE SHEET', { exact: true }),
  ).toBeVisible();

  await detail.getByRole('button', { name: 'Submit for review' }).click();
  await expect(detail.getByLabel('Workflow status')).toContainText('FOR REVIEW');

  await detail.getByRole('button', { name: 'Return for correction' }).click();
  const returnDialog = page.getByRole('region', { name: 'Return for correction' });
  await returnDialog
    .getByLabel('Reason')
    .fill('Correct the position title before the appointment is signed.');
  await returnDialog.getByRole('button', { name: 'Return for correction' }).click();
  await expect(detail.getByLabel('Workflow status')).toContainText('DRAFT');

  await detail.getByRole('tab', { name: 'Review & issuance' }).click();
  await expect(detail.getByText('APPOINTMENT RETURNED · DRAFT')).toBeVisible();
  await expect(detail.getByText('APPOINTMENT SUBMITTED · FOR REVIEW')).toBeVisible();

  await detail.getByRole('tab', { name: 'Preparation & evidence' }).click();
  await detail.getByRole('button', { name: 'Submit for review' }).click();
  await expect(detail.getByLabel('Workflow status')).toContainText('FOR REVIEW');
  await detail.getByRole('button', { name: 'Endorse for signature' }).click();
  await expect(detail.getByLabel('Workflow status')).toContainText('FOR SIGNATURE');

  page.once('dialog', (dialog) => void dialog.accept());
  await detail.getByRole('button', { name: 'Issue Appointment' }).click();
  await expect(detail.getByLabel('Workflow status')).toContainText('ISSUED');
  await expect(detail.getByLabel('Version v1')).toContainText('ISSUED');
  await expect(detail.getByText('Current version v1 · ISSUED')).toBeVisible();

  await detail.getByRole('tab', { name: 'CSC transactions' }).click();
  await expect(detail.getByLabel('External standing').first()).toContainText('NOT SUBMITTED');

  await detail.getByRole('button', { name: 'Record submission event' }).click();
  const submission = page.getByRole('region', { name: 'Record CSC submission event' });
  await submission.getByLabel('Receiving office').fill('CSC Field Office');
  await submission.getByLabel('External reference (optional)').fill('CSC-2026-0001');
  await submission
    .getByLabel('Exact evidence (finalized Document Version)')
    .selectOption({ index: 1 });
  await submission.getByRole('button', { name: 'Record submission event' }).click();
  await expect(detail.getByLabel('External standing').first()).toContainText('SUBMITTED');
  await expect(detail.getByText('Submission history')).toBeVisible();
  await expect(detail.getByText('CSC Field Office')).toBeVisible();

  await detail.getByRole('button', { name: 'Record official action' }).click();
  const action = page.getByRole('region', { name: 'Record official CSC action' });
  await action.getByLabel('External reference').fill('CSC-2026-0001');
  await action.getByLabel('Exact evidence (finalized Document Version)').selectOption({ index: 1 });
  await action.getByRole('button', { name: 'Record official action' }).click();
  await expect(detail.getByLabel('External standing').first()).toContainText('APPROVED');

  await detail.getByRole('tab', { name: 'Review & issuance' }).click();
  await expect(detail.getByText('APPOINTMENT EXTERNAL SUBMISSION RECORDED')).toHaveCount(0);

  await detail.getByRole('tab', { name: 'Preparation & evidence' }).click();
  await detail.getByRole('button', { name: 'Prepare linked correction' }).click();
  const correction = page.getByRole('region', { name: 'Prepare a linked correction' });
  await correction
    .getByLabel('Reason')
    .fill('Correct the salary step under the recorded correction authority.');
  await correction
    .getByLabel('Authority evidence (finalized Document Version)')
    .selectOption({ index: 1 });
  await correction.getByRole('button', { name: 'Prepare correction Draft' }).click();

  await expect(detail.getByLabel('Workflow status')).toContainText('DRAFT');
  await expect(detail.getByLabel('Version v1')).toContainText('ISSUED');
  await expect(detail.getByLabel('Version v2')).toContainText('DRAFT');
  await expect(detail.getByText('Current version v2 · DRAFT')).toBeVisible();

  await detail.getByRole('button', { name: 'Submit for review' }).click();
  await expect(detail.getByLabel('Workflow status')).toContainText('FOR REVIEW');
  await detail.getByRole('button', { name: 'Endorse for signature' }).click();
  await expect(detail.getByLabel('Workflow status')).toContainText('FOR SIGNATURE');

  await detail.getByRole('button', { name: 'Cancel Appointment' }).click();
  const cancel = page.getByRole('region', { name: 'Cancel Appointment' });
  await cancel
    .getByLabel('Reason')
    .fill('The appointee withdrew before assumption; release the reservation.');
  await cancel
    .getByLabel('Authority evidence (finalized Document Version)')
    .selectOption({ index: 1 });
  await cancel.getByRole('button', { name: 'Cancel Appointment' }).click();

  await expect(detail.getByLabel('Workflow status')).toContainText('CANCELLED');
  await expect(detail.getByLabel('Version v1')).toContainText('ISSUED');
  await expect(detail.getByRole('button', { name: 'Cancel Appointment' })).toBeHidden();
});
