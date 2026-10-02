import { expect, test, type APIResponse } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

const nationalRuleDocumentId = '77777777-7777-4777-8777-777777777777';

async function apiBody<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

test('opens, adjusts, freezes, reverses, and closes a Leave Account from the protected register', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();

  const headers = { origin: new URL(page.url()).origin };
  const session = await apiBody<{ agencyId: string }>(
    await page.request.get('/api/v1/auth/me', { headers }),
  );
  const agencyBase = `/api/v1/agencies/${session.agencyId}`;
  const leaveType = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/leave-types`, {
      headers,
      data: { catalogueCode: 'SICK_LEAVE' },
    }),
  );
  const version = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/leave-types/${leaveType.id}/policy-versions`, {
      headers,
      data: {
        effectiveDate: '2026-01-01',
        approvalRouteCode: 'LEAVE-SICK-ROUTE',
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Activating Sick Leave for Leave Account coverage.',
      },
    }),
  );
  await apiBody(
    await page.request.post(
      `${agencyBase}/leave-types/${leaveType.id}/policy-versions/${version.id}/authorities`,
      {
        headers,
        data: {
          authorityClass: 'NATIONAL_RULE',
          documentId: nationalRuleDocumentId,
          citation: 'Omnibus Rules Implementing Book V of EO 292, Rule XVI',
        },
      },
    ),
  );
  await apiBody(
    await page.request.post(
      `${agencyBase}/leave-types/${leaveType.id}/policy-versions/${version.id}/activate`,
      { headers, data: { reason: 'National rule verified for the Agency.' } },
    ),
  );
  const employees = await apiBody<{ employees: Array<{ id: string; employeeNumber: string }> }>(
    await page.request.get(`${agencyBase}/employees`, { headers }),
  );
  const employee = employees.employees.find(({ employeeNumber }) => employeeNumber === 'E2E-0001');
  if (!employee) throw new Error('The E2E-0001 Employee fixture is missing.');

  await page.goto('/leave-accounts');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Leave Accounts', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open Leave Account' }).click();
  const open = page.getByRole('region', { name: 'Open Leave Account' });
  await expect(open).toHaveAccessibleDescription(
    'Establish one Leave Account for an Employee and credit-bearing Leave Type, backed by an exact Document Version.',
  );
  await open.getByLabel('Employee').selectOption(employee.id);
  await open.getByLabel('Leave type').selectOption(leaveType.id);
  await open.getByLabel('Effective date').fill('2026-01-15');
  await open.getByLabel('Opening quantity').fill('12');
  await open.getByLabel('Evidence Document ID').fill(nationalRuleDocumentId);
  await open
    .getByLabel('Reason (optional)')
    .fill('Opening Sick Leave credits from the activated policy.');
  await open.getByRole('button', { name: 'Open Leave Account' }).click();
  await expect(page.getByRole('status').first()).toContainText('The Leave Account was opened.');

  const registerRow = page.getByRole('row').filter({ hasText: 'E2E-0001' });
  await expect(registerRow).toContainText('Sick Leave');
  await expect(registerRow).toContainText('ACTIVE');
  await expect(registerRow).toContainText('12');

  await registerRow.getByRole('button', { name: 'Alex Rivera' }).click();
  const detail = page.getByRole('region', { name: 'Alex Rivera', exact: true });
  await expect(detail).toContainText('12 credit day');

  await detail.getByRole('button', { name: 'Adjust credits' }).click();
  const adjust = page.getByRole('region', { name: 'Post credit adjustment' });
  await adjust.getByLabel('Signed quantity').fill('-4');
  await adjust.getByLabel('Effective date').fill('2026-02-02');
  await adjust.getByLabel('Authority Document ID').fill(nationalRuleDocumentId);
  await adjust.getByLabel('Evidence Document ID').fill(nationalRuleDocumentId);
  await adjust.getByLabel('Reason').fill('Correcting an overstated opening posting.');
  await adjust.getByRole('button', { name: 'Post adjustment' }).click();
  await expect(detail).toContainText('The Leave Credit adjustment was posted.');
  await expect(detail).toContainText('8 credit day');
  const adjustmentRow = detail
    .getByRole('row')
    .filter({ hasText: 'Leave Ledger Adjustment · ADJUSTMENT' });
  await expect(adjustmentRow).toContainText('-4');

  await detail.getByRole('button', { name: 'Freeze', exact: true }).click();
  const freeze = page.getByRole('region', { name: 'Freeze Leave Account' });
  await freeze.getByLabel('Reason').fill('Disputed credits pending review.');
  await freeze.getByRole('button', { name: 'Freeze account' }).click();
  await expect(detail).toContainText('FROZEN');
  await expect(detail.getByRole('button', { name: 'Adjust credits' })).toHaveCount(0);

  await detail.getByRole('button', { name: 'Unfreeze' }).click();
  const unfreeze = page.getByRole('region', { name: 'Unfreeze Leave Account' });
  await unfreeze.getByLabel('Reason').fill('The dispute was resolved.');
  await unfreeze.getByRole('button', { name: 'Unfreeze account' }).click();
  await expect(detail).toContainText('ACTIVE');

  await adjustmentRow.getByRole('button', { name: 'Reverse' }).click();
  const reverse = page.getByRole('region', { name: 'Reverse Leave Ledger Entry' });
  await reverse.getByLabel('Authority Document ID').fill(nationalRuleDocumentId);
  await reverse.getByLabel('Evidence Document ID').fill(nationalRuleDocumentId);
  await reverse.getByLabel('Reason').fill('Reversing the overstated adjustment.');
  await reverse.getByRole('button', { name: 'Reverse entry' }).click();
  await expect(detail).toContainText('The Leave Ledger Entry was reversed.');
  await expect(detail).toContainText('12 credit day');
  await expect(detail.getByText('Reversed', { exact: true })).toBeVisible();

  await detail.getByRole('button', { name: 'Close account' }).click();
  const close = page.getByRole('region', { name: 'Close Leave Account' });
  await close.getByLabel('Reason').fill('Separated from the Agency.');
  await close.getByRole('button', { name: 'Close account' }).click();
  await expect(detail).toContainText('CLOSED');
  await expect(detail.getByRole('button', { name: 'Adjust credits' })).toHaveCount(0);
});
