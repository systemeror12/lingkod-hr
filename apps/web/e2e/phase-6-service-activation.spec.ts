import { expect, test } from '@playwright/test';

function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test('activates the Employee service from an assumed Appointment', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/appointments');
  await expect(page.getByRole('heading', { name: 'Appointments', exact: true })).toBeVisible();

  const eligible = page.getByRole('region', { name: 'Eligible selections' });
  const eligibleRow = eligible.getByRole('row').filter({ hasText: 'Activation Candidate' });
  await expect(eligibleRow).toBeVisible();
  await eligibleRow.getByRole('button', { name: 'Prepare Appointment' }).click();

  const prepare = page.getByRole('region', { name: 'Prepare Appointment' });
  await expect(prepare.getByLabel('Appointment form (finalized Document Version)')).not.toHaveValue(
    '',
  );
  await prepare.getByRole('button', { name: 'Prepare Draft' }).click();

  const detail = page.getByRole('region', { name: 'Activation Candidate' });
  await expect(detail.getByLabel('Workflow status')).toContainText('DRAFT');

  await detail.getByRole('button', { name: 'Submit for review' }).click();
  await expect(detail.getByLabel('Workflow status')).toContainText('FOR REVIEW');
  await detail.getByRole('button', { name: 'Endorse for signature' }).click();
  await expect(detail.getByLabel('Workflow status')).toContainText('FOR SIGNATURE');

  page.once('dialog', (dialog) => void dialog.accept());
  await detail.getByRole('button', { name: 'Issue Appointment' }).click();
  await expect(detail.getByLabel('Workflow status')).toContainText('ISSUED');

  await detail.getByRole('tab', { name: 'Oath & assumption' }).click();
  await detail.getByRole('button', { name: 'Record acknowledgment' }).click();
  const receipt = page.getByRole('region', {
    name: 'Record appointee acknowledgment of receipt',
  });
  const acknowledgedAt = receipt.getByLabel('Acknowledged at');
  const nextMinute = new Date(new Date(await acknowledgedAt.inputValue()).getTime() + 60_000);
  await acknowledgedAt.fill(localDateTime(nextMinute));
  await receipt
    .getByLabel('Exact evidence (finalized Document Version)')
    .selectOption({ index: 1 });
  await receipt.getByRole('button', { name: 'Record acknowledgment' }).click();
  await expect(detail.getByLabel('Assumption status')).toContainText('PENDING');

  await detail.getByRole('button', { name: 'Record Oath' }).click();
  const oath = page.getByRole('region', { name: 'Record Oath of Office' });
  await oath.getByLabel('Authority', { exact: true }).fill('City Mayor');
  await oath.getByLabel('Exact evidence (finalized Document Version)').selectOption({ index: 1 });
  await oath.getByRole('button', { name: 'Record Oath' }).click();

  await detail.getByRole('button', { name: 'Certify Assumption to Duty' }).click();
  const assumption = page.getByRole('region', { name: 'Certify Assumption to Duty' });
  await assumption.getByLabel('Certifying authority').fill('Appointing Authority');
  await assumption
    .getByLabel('Exact evidence (finalized Document Version)')
    .selectOption({ index: 1 });
  await assumption.getByRole('button', { name: 'Certify Assumption to Duty' }).click();
  await expect(detail.getByLabel('Assumption status')).toContainText('ASSUMED');
  await expect(detail.getByText('Employee service activation')).toBeVisible();

  await detail.getByRole('button', { name: 'Activate service' }).click();
  const activation = page.getByRole('region', { name: 'Activate Employee service' });
  await activation.getByLabel('Employee number').fill('E2E-ACT-0001');
  await activation.getByLabel('Birth date').fill('1991-02-03');
  await activation.getByLabel('Contact email').fill('activation.employee@example.test');
  await activation.getByRole('button', { name: 'Activate service' }).click();

  await expect(
    detail.getByText('Activation Candidate · E2E-ACT-0001', { exact: true }),
  ).toBeVisible();
  await expect(detail.getByText('Service Segment', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Activate service' })).toBeHidden();

  await detail.getByRole('tab', { name: 'Review & issuance' }).click();
  await expect(detail.getByText('APPOINTMENT SERVICE ACTIVATED').first()).toBeVisible();
});
