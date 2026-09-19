import { expect, test, type APIResponse } from '@playwright/test';

const nationalRuleDocumentId = '77777777-7777-4777-8777-777777777777';
const leaveRouteCode = 'LEAVE-VACATION-ROUTE';

async function apiBody<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

test('prepares, checks eligibility, submits, and withdraws a Leave Application from the protected register', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();

  const headers = { origin: new URL(page.url()).origin };
  const session = await apiBody<{ agencyId: string; membershipId: string }>(
    await page.request.get('/api/v1/auth/me', { headers }),
  );
  const agencyBase = `/api/v1/agencies/${session.agencyId}`;
  const leaveType = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/leave-types`, {
      headers,
      data: { catalogueCode: 'VACATION_LEAVE' },
    }),
  );
  const version = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/leave-types/${leaveType.id}/policy-versions`, {
      headers,
      data: {
        effectiveDate: '2026-01-01',
        approvalRouteCode: leaveRouteCode,
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Activating Vacation Leave for Leave Application coverage.',
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
  const route = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/approval-routes`, {
      headers,
      data: {
        routeCode: leaveRouteCode,
        domain: 'leave',
        versionNo: 1,
        effectiveFrom: '2026-01-01',
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'approvals.requests.approve',
              approvePermission: 'approvals.requests.approve',
              returnPermission: 'approvals.requests.return',
              rejectPermission: 'approvals.requests.reject',
              assignment: { kind: 'MEMBERSHIP', membershipId: session.membershipId },
              requiresSeparateReview: false,
            },
          ],
        },
      },
    }),
  );
  await apiBody(
    await page.request.post(`${agencyBase}/approval-routes/${route.id}/activate`, {
      headers,
      data: { reason: 'Approval route verified for Leave Application coverage.' },
    }),
  );
  const employees = await apiBody<{ employees: Array<{ id: string; employeeNumber: string }> }>(
    await page.request.get(`${agencyBase}/employees`, { headers }),
  );
  const employee = employees.employees.find(({ employeeNumber }) => employeeNumber === 'E2E-0001');
  if (!employee) throw new Error('The E2E-0001 Employee fixture is missing.');
  const documentVersions = await apiBody<{
    documents: Array<{ documentId: string; version: { id: string } }>;
  }>(await page.request.get(`${agencyBase}/documents/versions`, { headers }));
  const formTemplate = documentVersions.documents.find(
    ({ documentId }) => documentId === nationalRuleDocumentId,
  );
  if (!formTemplate) throw new Error('The national rule Document Version fixture is missing.');

  await page.goto('/leave-applications');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Leave Applications', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Prepare Leave Application' }).click();
  const prepare = page.getByRole('region', { name: 'Prepare Leave Application' });
  await prepare.getByLabel('Employee').selectOption(employee.id);
  await prepare.getByLabel('Leave type').selectOption(leaveType.id);
  await prepare.getByRole('button', { name: 'Prepare Leave Application' }).click();
  const detail = page.getByRole('region', { name: 'Alex Rivera', exact: true });
  await expect(detail).toContainText('The Leave Application draft was prepared.');
  await expect(detail).toContainText('DRAFT');

  await detail.getByLabel('Reason').fill('Rest and recreation leave for the E2E fixture.');
  await detail.getByLabel('Period start').fill('2026-06-01');
  await detail.getByLabel('Period end').fill('2026-06-03');
  await detail.getByRole('button', { name: 'Add evidence' }).click();
  await detail.getByLabel('Evidence Document ID').fill(nationalRuleDocumentId);
  await detail.getByLabel('Evidence purpose').selectOption('SIGNED_LEAVE_APPLICATION_FORM');
  await detail.getByRole('button', { name: 'Save draft' }).click();
  await expect(detail).toContainText('The Leave Application draft was saved.');

  await detail.getByRole('button', { name: 'Check eligibility' }).click();
  const eligibility = detail.getByRole('region', { name: 'Eligibility' });
  await expect(eligibility).toContainText('ELIGIBLE');
  await expect(eligibility).toContainText('3');

  await detail.getByLabel('Form template Document Version ID').fill(formTemplate.version.id);
  await detail.getByLabel('Attestation').selectOption('SIGNED_DOCUMENT');
  await detail.getByLabel('Signed document ID').fill(nationalRuleDocumentId);
  await detail.getByLabel('Received at').fill('2026-06-01T09:00');
  await detail.getByRole('button', { name: 'Submit application' }).click();
  await expect(detail).toContainText('The Leave Application was submitted.');
  await expect(detail).toContainText('SUBMITTED');
  await expect(detail).toContainText('Version 1');

  await detail
    .getByLabel('Withdrawal reason')
    .fill('Withdrawn by the recorder for the E2E fixture.');
  await detail
    .getByLabel('Withdrawal evidence Document ID (optional)')
    .fill(nationalRuleDocumentId);
  await detail.getByRole('button', { name: 'Withdraw application' }).click();
  await expect(detail).toContainText('The Leave Application was withdrawn.');
  await expect(detail).toContainText('WITHDRAWN');
});
