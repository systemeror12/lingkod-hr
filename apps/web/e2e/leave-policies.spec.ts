import { expect, test } from '@playwright/test';

const nationalRuleDocumentId = '77777777-7777-4777-8777-777777777777';

test('activates an evidence-backed Leave Policy Version from the government catalogue', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  await page.goto('/leave-policies');
  await expect(page.getByRole('heading', { name: 'Leave Policies' })).toBeVisible();
  await expect(page.getByText('16 catalogue entries')).toBeVisible();

  const catalogueSection = page.getByRole('region', { name: 'Government leave catalogue' });
  const agencySection = page.getByRole('region', { name: 'Agency Leave Types' });
  const catalogueRow = catalogueSection.getByRole('row').filter({ hasText: /^Vacation Leave/ });
  await expect(catalogueRow).toContainText('Vacation Leave');
  await expect(catalogueRow).toContainText('Service accrual');
  await expect(catalogueRow).toContainText('Working day');
  await catalogueRow.getByRole('button', { name: 'Admit Leave Type' }).click();

  const createDialog = page.getByRole('region', { name: 'Admit Leave Type' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog).toHaveAccessibleDescription(
    'Create the Agency Leave Type from one admitted government catalogue entry.',
  );
  await expect(page.getByLabel('Catalogue entry')).toHaveValue('VACATION_LEAVE');
  await page.getByRole('button', { name: 'Create Leave Type' }).click();

  const status = page.getByRole('status').first();
  await expect(status).toContainText('Vacation Leave is now an Agency Leave Type.');
  await expect(catalogueSection.getByRole('button', { name: 'Admit Leave Type' })).toHaveCount(15);

  const listRow = agencySection.getByRole('row').filter({ hasText: 'VACATION_LEAVE' });
  await expect(listRow).toContainText('No active version');
  await expect(listRow).toContainText('None');
  await expect(listRow).toContainText('ACTIVE');
  await listRow.getByRole('button', { name: 'VACATION_LEAVE' }).click();

  const detail = page.getByRole('region', { name: 'Vacation Leave' });
  await expect(detail).toBeVisible();
  await expect(detail.getByText('No effective Leave Policy Version on this date')).toBeVisible();

  await page.getByLabel('Approval route code').fill('LEAVE-VACATION-ROUTE');
  await page.getByLabel('Reason').fill('Admitting the Vacation Leave catalogue entry.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(status).toContainText('A draft Leave Policy Version was created.');

  await page.getByLabel('Document ID').fill(nationalRuleDocumentId);
  await page.getByLabel('Citation').fill('Omnibus Rules Implementing Book V of EO 292, Rule XVI');
  await page.getByRole('button', { name: 'Link authority' }).click();
  await expect(status).toContainText('The authority Document Version was linked to the draft.');
  await expect(detail).toContainText('National rule · version 1');
  await expect(detail).toContainText('E2E-LEAVE-NATIONAL-RULE');

  await page
    .getByLabel('Activation reason')
    .fill('National rule and coverage verified for the Agency.');
  await page.getByRole('button', { name: 'Activate version' }).click();
  await expect(status).toContainText('The Leave Policy Version is active.');
  await expect(detail).toContainText('Version 1');
  await expect(detail).toContainText('Service accrual');
  await expect(detail).toContainText('perServiceDays');
  await expect(detail).toContainText('24');

  const versionRow = detail.getByRole('row').filter({ hasText: 'v1' });
  await expect(versionRow).toContainText('ACTIVE');
  await expect(versionRow).toContainText('National v1');
  await expect(detail).toContainText('LEAVE_POLICY_VERSION_ACTIVATED');

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const activatedRow = agencySection.getByRole('row').filter({ hasText: 'VACATION_LEAVE' });
  await expect(activatedRow).toContainText('Version 1');
  await expect(activatedRow).toContainText('ACTIVE');
});
