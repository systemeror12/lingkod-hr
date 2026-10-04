import { expect, test, type APIResponse } from '@playwright/test';
import { MARISOL_EMAIL, signIn } from './sign-in';

const nationalRuleDocumentId = '77777777-7777-4777-8777-777777777777';

async function apiBody<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

test('records a Leave Monetization Request with signed attestation and keeps the recorder from certifying', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, MARISOL_EMAIL);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();

  const headers = { origin: new URL(page.url()).origin };
  const session = await apiBody<{ agencyId: string }>(
    await page.request.get('/api/v1/auth/me', { headers }),
  );
  const agencyBase = `/api/v1/agencies/${session.agencyId}`;

  const leaveTypes = await apiBody<{
    leaveTypes: Array<{
      id: string;
      code: string;
      currentVersion: { effectiveFrom: string } | null;
    }>;
  }>(await page.request.get(`${agencyBase}/leave-types`, { headers }));
  const admittedVacationLeave = leaveTypes.leaveTypes.find(({ code }) => code === 'VACATION_LEAVE');
  let policyEffectiveFrom = '2026-01-01';
  let leaveType: { id: string };
  if (admittedVacationLeave?.currentVersion) {
    leaveType = admittedVacationLeave;
    policyEffectiveFrom = admittedVacationLeave.currentVersion.effectiveFrom;
  } else {
    leaveType =
      admittedVacationLeave ??
      (await apiBody<{ id: string }>(
        await page.request.post(`${agencyBase}/leave-types`, {
          headers,
          data: { catalogueCode: 'VACATION_LEAVE' },
        }),
      ));
    const policyVersion = await apiBody<{ id: string }>(
      await page.request.post(`${agencyBase}/leave-types/${leaveType.id}/policy-versions`, {
        headers,
        data: {
          effectiveDate: policyEffectiveFrom,
          approvalRouteCode: 'LEAVE-VL-ROUTE',
          applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
          documentRequirements: {},
          reason: 'Activating Vacation Leave for Leave Monetization coverage.',
        },
      }),
    );
    await apiBody(
      await page.request.post(
        `${agencyBase}/leave-types/${leaveType.id}/policy-versions/${policyVersion.id}/authorities`,
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
        `${agencyBase}/leave-types/${leaveType.id}/policy-versions/${policyVersion.id}/activate`,
        { headers, data: { reason: 'National rule verified for the Agency.' } },
      ),
    );
  }
  const accountEffectiveDate =
    policyEffectiveFrom > '2026-01-15' ? policyEffectiveFrom : '2026-01-15';
  const employees = await apiBody<{ employees: Array<{ id: string; employeeNumber: string }> }>(
    await page.request.get(`${agencyBase}/employees`, { headers }),
  );
  const employee = employees.employees.find(({ employeeNumber }) => employeeNumber === 'E2E-0001');
  if (!employee) throw new Error('The E2E-0001 Employee fixture is missing.');
  const accounts = await apiBody<{
    accounts: Array<{ id: string; employeeId: string; leaveTypeId: string; status: string }>;
  }>(await page.request.get(`${agencyBase}/leave-accounts`, { headers }));
  const account =
    accounts.accounts.find(
      (candidate) =>
        candidate.employeeId === employee.id &&
        candidate.leaveTypeId === leaveType.id &&
        candidate.status === 'ACTIVE',
    ) ??
    (await apiBody<{ id: string }>(
      await page.request.post(`${agencyBase}/leave-accounts`, {
        headers,
        data: {
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          effectiveDate: accountEffectiveDate,
          openingQuantity: 40,
          evidenceDocumentId: nationalRuleDocumentId,
          reason: 'Opening Vacation Leave credits for Leave Monetization coverage.',
        },
      }),
    ));
  const linkableVersions = await apiBody<{
    documents: Array<{ version: { id: string } }>;
  }>(await page.request.get(`${agencyBase}/documents/versions`, { headers }));
  const formTemplateDocumentVersionId = linkableVersions.documents[0]?.version.id;
  if (!formTemplateDocumentVersionId) {
    throw new Error('The linkable Document Version fixture is missing.');
  }

  await page.goto('/leave-monetization');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Leave Monetization', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New request' }).click();
  const create = page.getByRole('region', { name: 'New Leave Monetization Request' });
  await expect(create).toHaveAccessibleDescription(
    'Draft one stable request for an Employee. Submitted versions become immutable.',
  );
  await create.getByLabel('Employee').selectOption(employee.id);
  await create.getByRole('button', { name: 'Draft request' }).click();
  await expect(page.getByRole('status').first()).toContainText(
    'The Leave Monetization Request was drafted.',
  );

  const registerRow = page.getByRole('row').filter({ hasText: 'E2E-0001' }).first();
  await expect(registerRow).toContainText('DRAFT');
  await registerRow.getByRole('button', { name: 'Alex Rivera' }).click();
  const detail = page.getByRole('region', { name: 'Alex Rivera', exact: true });
  await expect(detail).toContainText('No assessment recorded.');
  await expect(detail).toContainText('None — not posted.');

  await detail.getByRole('button', { name: 'Submit version' }).click();
  const submit = page.getByRole('region', { name: 'Submit Monetization Version' });
  await submit.getByLabel('Form template Document Version ID').fill(formTemplateDocumentVersionId);
  const attestation = submit.getByRole('combobox', { name: 'Attestation' });
  await expect(attestation).toHaveValue('SIGNED_DOCUMENT');
  await expect(attestation.getByRole('option')).toHaveText(['Signed document']);
  await submit
    .getByLabel('Signed attestation Document Version ID')
    .fill(formTemplateDocumentVersionId);
  await submit.getByLabel('Citations (one per line)').fill('CSC MC No. 41, s. 1998, s. 22');
  await submit.getByLabel('Valuation date').fill(accountEffectiveDate);
  await submit.getByLabel('Leave Account 1').selectOption(account.id);
  await submit.getByLabel('Requested quantity').fill('10');
  await submit.getByRole('button', { name: 'Submit version' }).click();
  await expect(detail).toContainText('The version was submitted and bound to its Approval Route.');
  await expect(detail).toContainText('SUBMITTED');
  await expect(detail).toContainText('10');

  await detail.getByRole('button', { name: 'Assess eligibility' }).click();
  const assess = page.getByRole('region', { name: 'Record eligibility assessment' });
  await assess.getByRole('button', { name: 'Record assessment' }).click();
  await expect(detail).toContainText('The Monetization Eligibility Assessment was recorded.');
  await expect(detail).toContainText('ELIGIBLE');
  await expect(detail).toContainText('REGULAR_VL_ONLY');

  await detail.getByRole('button', { name: 'Certify credits' }).click();
  const certify = page.getByRole('region', { name: 'Certify monetization credits' });
  await certify.getByRole('button', { name: 'Certify credits' }).click();
  await expect(certify.getByRole('alert')).toContainText(
    'The recording actor cannot perform this Monetization step.',
  );
  await certify.getByRole('button', { name: 'Cancel' }).click();
  await expect(registerRow).toContainText('SUBMITTED');
  const afterCertify = await apiBody<{
    items: Array<{ employeeNumber: string; status: string }>;
  }>(await page.request.get(`${agencyBase}/leave-monetization`, { headers }));
  expect(
    afterCertify.items.find(({ employeeNumber }) => employeeNumber === 'E2E-0001')?.status,
  ).toBe('SUBMITTED');
});
