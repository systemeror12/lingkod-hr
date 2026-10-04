import { PrismaClient } from '@prisma/client';
import { getConfig } from '@lingkod-hr/config';
import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { activateInvitation, MARISOL_EMAIL, signIn } from './sign-in';

const nationalRuleDocumentId = '77777777-7777-4777-8777-777777777777';

interface LeaveTypeSummary {
  id: string;
  code: string;
  currentVersion: { effectiveFrom: string } | null;
}

async function apiBody<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

async function withAdmin<T>(work: (admin: PrismaClient) => Promise<T>): Promise<T> {
  getConfig();
  const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!adminUrl) throw new Error('A worktree database owner URL is required for the fixture.');
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    return await work(admin);
  } finally {
    await admin.$disconnect();
  }
}

/** Reuse the Agency's current policy for a catalogue Leave Type, or activate one. */
async function ensureLeavePolicy(
  page: Page,
  agencyBase: string,
  headers: Record<string, string>,
  catalogueCode: string,
): Promise<{ id: string; effectiveFrom: string }> {
  const { leaveTypes } = await apiBody<{ leaveTypes: LeaveTypeSummary[] }>(
    await page.request.get(`${agencyBase}/leave-types`, { headers }),
  );
  const admitted = leaveTypes.find(({ code }) => code === catalogueCode);
  if (admitted?.currentVersion) {
    return { id: admitted.id, effectiveFrom: admitted.currentVersion.effectiveFrom };
  }
  const leaveType =
    admitted ??
    (await apiBody<{ id: string }>(
      await page.request.post(`${agencyBase}/leave-types`, { headers, data: { catalogueCode } }),
    ));
  const effectiveFrom = '2026-01-01';
  const version = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/leave-types/${leaveType.id}/policy-versions`, {
      headers,
      data: {
        effectiveDate: effectiveFrom,
        approvalRouteCode: 'LEAVE-VL-ROUTE',
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: `Activating ${catalogueCode} for Mandatory Leave coverage.`,
      },
    }),
  );
  const authorities = `${agencyBase}/leave-types/${leaveType.id}/policy-versions/${version.id}/authorities`;
  await apiBody(
    await page.request.post(authorities, {
      headers,
      data: {
        authorityClass: 'NATIONAL_RULE',
        documentId: nationalRuleDocumentId,
        citation: 'Omnibus Rules Implementing Book V of EO 292, Rule XVI',
      },
    }),
  );
  if (catalogueCode === 'MANDATORY_LEAVE') {
    await apiBody(
      await page.request.post(authorities, {
        headers,
        data: {
          authorityClass: 'AGENCY_CONFIGURATION',
          documentId: nationalRuleDocumentId,
          citation: 'Agency mandatory leave schedule',
          validationReason: 'Approved by the agency head.',
        },
      }),
    );
  }
  await apiBody(
    await page.request.post(
      `${agencyBase}/leave-types/${leaveType.id}/policy-versions/${version.id}/activate`,
      { headers, data: { reason: 'National rule verified for the Agency.' } },
    ),
  );
  return { id: leaveType.id, effectiveFrom };
}

/** The register pages by Employee name; load pages until the row appears. */
async function findRow(page: Page, employeeNumber: string): Promise<Locator> {
  const row = page.getByRole('row').filter({ hasText: employeeNumber });
  const more = page.getByRole('button', { name: 'Load more' });
  while ((await row.count()) === 0 && (await more.isVisible())) {
    await more.click();
    await expect(more.or(row).first()).toBeVisible();
  }
  await expect(row).toHaveCount(1);
  return row;
}

test('evaluates a reached vacation balance, starts fulfillment as an ordinary application, and shows the Employee their own obligation', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, MARISOL_EMAIL, { fresh: true });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();

  const headers = { origin: new URL(page.url()).origin };
  const session = await apiBody<{ agencyId: string }>(
    await page.request.get('/api/v1/auth/me', { headers }),
  );
  const agencyBase = `/api/v1/agencies/${session.agencyId}`;
  const vacation = await ensureLeavePolicy(page, agencyBase, headers, 'VACATION_LEAVE');
  await ensureLeavePolicy(page, agencyBase, headers, 'MANDATORY_LEAVE');

  const stamp = Date.now();
  const employeeNumber = `E2E-ML-${stamp}`;
  const employeeName = `Mandatory Leave ${stamp}`;
  const employee = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/employees`, {
      headers,
      data: {
        employeeNumber,
        legalName: employeeName,
        birthDate: '1990-05-01',
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: `mandatory-leave-${stamp}@example.test`,
      },
    }),
  );
  await apiBody(
    await page.request.post(`${agencyBase}/leave-accounts`, {
      headers,
      data: {
        employeeId: employee.id,
        leaveTypeId: vacation.id,
        effectiveDate:
          vacation.effectiveFrom > '2026-01-15' ? vacation.effectiveFrom : '2026-01-15',
        openingQuantity: 10,
        evidenceDocumentId: nationalRuleDocumentId,
        reason: 'Opening Vacation Leave credits for Mandatory Leave coverage.',
      },
    }),
  );

  await page.goto('/mandatory-leave?year=2026');
  await expect(page.getByRole('heading', { level: 1, name: 'Mandatory Leave' })).toBeVisible();
  const before = await findRow(page, employeeNumber);
  await expect(before).toContainText('Not yet evaluated');

  await page.getByRole('button', { name: 'Evaluate 2026' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Evaluated / })).toContainText(
    'SUBJECT',
  );
  const row = await findRow(page, employeeNumber);
  await expect(row.getByRole('cell')).toHaveText(['SUBJECT', '5', '0', '5', /2026/]);

  await row.getByRole('button', { name: employeeName }).click();
  const detail = page.getByRole('region', { name: employeeName, exact: true });
  await expect(detail).toHaveAccessibleDescription(
    'The recorded assessment and its reasons. It is not a leave approval, a certification, or a forfeiture.',
  );
  await expect(detail.getByText('BALANCE_THRESHOLD', { exact: true })).toBeVisible();
  await expect(detail).not.toContainText(/forfeited/i);

  await detail.getByRole('link', { name: 'File leave' }).click();
  await expect(page).toHaveURL(/\/leave-applications$/);
  const prepare = page.getByRole('region', { name: 'Prepare Leave Application' });
  await expect(prepare.getByLabel('Employee')).toHaveValue(employee.id);
  await expect(prepare.getByLabel('Leave type').locator('option:checked')).toContainText(
    'MANDATORY_LEAVE',
  );
  await prepare.getByRole('button', { name: 'Prepare Leave Application' }).click();
  await expect(page.getByRole('status').first()).toContainText(
    'The Leave Application draft was prepared.',
  );

  const invitation = await apiBody<{ activationUrl: string }>(
    await page.request.post(`${agencyBase}/invitations`, {
      headers,
      data: { email: `mandatory-leave-${stamp}@example.test`, roleCodes: ['hrmo_administrator'] },
    }),
  );
  const employeePage = await (await browser.newContext()).newPage();
  await activateInvitation(employeePage, invitation.activationUrl, { name: employeeName });
  const own = await apiBody<{ membershipId: string }>(
    await employeePage.request.get('/api/v1/auth/me', {
      headers: { origin: new URL(employeePage.url()).origin },
    }),
  );
  // The Agency invitation API only invites HRMO Administrators, and no API reassigns roles yet.
  // Hold the invitee to the Employee role so the page shows their own scope.
  await withAdmin(async (admin) => {
    const role = await admin.role.findFirstOrThrow({
      where: { code: 'employee', OR: [{ agencyId: null }, { agencyId: session.agencyId }] },
    });
    await admin.membershipRole.updateMany({
      where: { membershipId: own.membershipId },
      data: { roleId: role.id },
    });
  });
  await apiBody(
    await page.request.post(`${agencyBase}/employees/${employee.id}/membership-link`, {
      headers,
      data: { membershipId: own.membershipId },
    }),
  );

  await employeePage.goto('/mandatory-leave');
  await expect(
    employeePage.getByRole('heading', { level: 1, name: 'Mandatory Leave' }),
  ).toBeVisible();
  await expect(employeePage.getByRole('button', { name: /^Evaluate/ })).toHaveCount(0);
  const ownRows = employeePage.getByRole('table').getByRole('row');
  await expect(ownRows).toHaveCount(2);
  await expect(ownRows.nth(1)).toContainText(employeeNumber);
  await expect(ownRows.nth(1)).toContainText('SUBJECT');
});
