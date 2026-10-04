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

/** Reuse an active approval route for the code, or create and activate the next version. */
async function ensureApprovalRoute(
  page: Page,
  agencyBase: string,
  headers: Record<string, string>,
  routeCode: string,
  membershipId: string,
): Promise<void> {
  const { routes } = await apiBody<{ routes: { status: string; versionNo: number }[] }>(
    await page.request.get(
      `${agencyBase}/approval-routes?routeCode=${encodeURIComponent(routeCode)}&limit=50`,
      { headers },
    ),
  );
  if (routes.some(({ status }) => status === 'ACTIVE')) return;
  const route = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/approval-routes`, {
      headers,
      data: {
        routeCode,
        domain: 'leave',
        versionNo: Math.max(0, ...routes.map(({ versionNo }) => versionNo)) + 1,
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
              assignment: { kind: 'MEMBERSHIP', membershipId },
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
      data: { reason: 'Approval route verified for Mandatory Leave coverage.' },
    }),
  );
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
  const session = await apiBody<{ agencyId: string; membershipId: string }>(
    await page.request.get('/api/v1/auth/me', { headers }),
  );
  const agencyBase = `/api/v1/agencies/${session.agencyId}`;
  const vacation = await ensureLeavePolicy(page, agencyBase, headers, 'VACATION_LEAVE');
  await ensureLeavePolicy(page, agencyBase, headers, 'MANDATORY_LEAVE');
  await ensureApprovalRoute(page, agencyBase, headers, 'LEAVE-VL-ROUTE', session.membershipId);
  const documentVersions = await apiBody<{
    documents: Array<{ documentId: string; version: { id: string } }>;
  }>(await page.request.get(`${agencyBase}/documents/versions`, { headers }));
  const formTemplate = documentVersions.documents.find(
    ({ documentId }) => documentId === nationalRuleDocumentId,
  );
  if (!formTemplate) throw new Error('The national rule Document Version fixture is missing.');

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
  // Filing needs service and a schedule on the leave dates. Appointment is out of this journey's
  // scope, so give the Employee the seeded E2E-0001 service and schedule terms.
  await withAdmin((admin) =>
    admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT set_config('app.personnel_baseline_transition', 'on', true)",
      );
      const seeded = await tx.employee.findFirstOrThrow({
        where: { agencyId: session.agencyId, employeeNumber: 'E2E-0001' },
        select: { id: true, currentServiceSegmentId: true },
      });
      const segment = await tx.serviceSegment.findUniqueOrThrow({
        where: { id: seeded.currentServiceSegmentId! },
      });
      const service = await tx.serviceSegment.create({
        data: {
          agencyId: segment.agencyId,
          employeeId: employee.id,
          positionId: segment.positionId,
          organizationUnitId: segment.organizationUnitId,
          appointmentStatus: segment.appointmentStatus,
          salaryGrade: segment.salaryGrade,
          salaryStep: segment.salaryStep,
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
          createdByMembershipId: segment.createdByMembershipId,
        },
      });
      await tx.employee.update({
        where: { id: employee.id },
        data: { currentServiceSegmentId: service.id },
      });
      await tx.$executeRawUnsafe(
        "SELECT set_config('app.schedule_assignment_transition', 'on', true)",
      );
      const assignment = await tx.scheduleAssignment.findFirstOrThrow({
        where: { agencyId: session.agencyId, employeeId: seeded.id },
        orderBy: { effectiveFrom: 'desc' },
      });
      await tx.scheduleAssignment.create({
        data: {
          agencyId: assignment.agencyId,
          employeeId: employee.id,
          workScheduleVersionId: assignment.workScheduleVersionId,
          workArrangementVersionId: assignment.workArrangementVersionId,
          authorityDocumentVersionId: assignment.authorityDocumentVersionId,
          effectiveFrom: new Date('2026-01-01'),
          assignedByMembershipId: assignment.assignedByMembershipId,
        },
      });
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
  await expect(detail.getByRole('heading', { name: 'Sources' })).toBeVisible();
  await expect(detail).toContainText('Vacation Leave Account');
  await expect(detail).not.toContainText(/forfeited/i);

  await detail.getByRole('link', { name: 'File leave' }).click();
  await expect(page).toHaveURL(/\/leave-applications$/);
  const prepare = page.getByRole('region', { name: 'Prepare Leave Application' });
  await expect(prepare.getByLabel('Employee')).toHaveValue(employee.id);
  await expect(prepare.getByLabel('Leave type').locator('option:checked')).toContainText(
    'MANDATORY_LEAVE',
  );
  await prepare.getByRole('button', { name: 'Prepare Leave Application' }).click();
  const application = page.getByRole('region', { name: employeeName, exact: true });
  await expect(application).toContainText('The Leave Application draft was prepared.');
  await application.getByLabel('Reason').fill('Mandatory leave for the E2E fixture.');
  await application.getByLabel('Commutation').selectOption('NOT_REQUESTED');
  await application.getByLabel('Period start').fill('2026-06-01');
  await application.getByLabel('Period end').fill('2026-06-03');
  await application.getByRole('button', { name: 'Add evidence' }).click();
  await application.getByLabel('Evidence Document ID').fill(nationalRuleDocumentId);
  await application.getByLabel('Evidence purpose').selectOption('SIGNED_LEAVE_APPLICATION_FORM');
  await application.getByRole('button', { name: 'Add evidence' }).click();
  await application.getByLabel('Evidence Document ID').last().fill(nationalRuleDocumentId);
  await application
    .getByLabel('Evidence purpose')
    .last()
    .selectOption('SCHEDULE_OR_CLEARANCE_EVIDENCE');
  await application.getByRole('button', { name: 'Save draft' }).click();
  await expect(application).toContainText('The Leave Application draft was saved.');
  await application.getByLabel('Form template Document Version ID').fill(formTemplate.version.id);
  await application.getByLabel('Attestation').selectOption('SIGNED_DOCUMENT');
  await application.getByLabel('Signed document ID').fill(nationalRuleDocumentId);
  await application.getByLabel('Received at').fill('2026-06-01T09:00');
  await application.getByRole('button', { name: 'Submit application' }).click();
  await expect(application).toContainText('The Leave Application was submitted.');
  await expect(application).toContainText('SUBMITTED');

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

test('shows a Supervisor only their direct reports, without the Evaluate action', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page, MARISOL_EMAIL, { fresh: true });
  await page.goto('/dashboard');
  const headers = { origin: new URL(page.url()).origin };
  const session = await apiBody<{ agencyId: string; membershipId: string }>(
    await page.request.get('/api/v1/auth/me', { headers }),
  );
  const agencyBase = `/api/v1/agencies/${session.agencyId}`;
  const stamp = Date.now();
  const createEmployee = async (role: string) =>
    apiBody<{ id: string; employeeNumber: string; legalName: string }>(
      await page.request.post(`${agencyBase}/employees`, {
        headers,
        data: {
          employeeNumber: `E2E-SUP-${role}-${stamp}`,
          legalName: `Supervisor ${role} ${stamp}`,
          birthDate: '1990-05-01',
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `supervisor-${role.toLowerCase()}-${stamp}@example.test`,
        },
      }),
    );
  const chief = await createEmployee('CHIEF');
  const report = await createEmployee('REPORT');

  // ADR 0005: the chief heads a fresh Division through its head Plantilla Position, and the
  // report serves in it. Organization and Plantilla projections normally require their
  // application services, which this journey does not exercise.
  await withAdmin((admin) =>
    admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const position = await tx.plantillaPosition.create({
        data: {
          agencyId: session.agencyId,
          itemNumber: `E2E-SUP-ITEM-${stamp}`,
          status: 'OCCUPIED',
          createdByMembershipId: session.membershipId,
          updatedByMembershipId: session.membershipId,
        },
      });
      const unit = await tx.organizationUnit.create({
        data: {
          agencyId: session.agencyId,
          code: `E2E-SUP-${stamp}`,
          unitType: 'DIVISION',
          status: 'ACTIVE',
        },
      });
      const version = await tx.organizationUnitVersion.create({
        data: {
          agencyId: session.agencyId,
          organizationUnitId: unit.id,
          versionNo: 1,
          name: `Supervisor Division ${stamp}`,
          headPositionId: position.id,
          effectiveFrom: new Date('2026-01-01'),
          status: 'ACTIVE',
          domainStatus: 'ACTIVE',
        },
      });
      await tx.organizationUnit.update({
        where: { id: unit.id },
        data: { currentVersionId: version.id },
      });
      for (const employee of [chief, report]) {
        const segment = await tx.serviceSegment.create({
          data: {
            agencyId: session.agencyId,
            employeeId: employee.id,
            positionId: employee === chief ? position.id : null,
            organizationUnitId: unit.id,
            appointmentStatus: 'PERMANENT',
            effectiveFrom: new Date('2026-01-01'),
            status: 'ACTIVE',
            createdByMembershipId: session.membershipId,
          },
        });
        if (employee === chief) {
          await tx.positionIncumbency.create({
            data: {
              agencyId: session.agencyId,
              positionId: position.id,
              employeeId: chief.id,
              serviceSegmentId: segment.id,
              effectiveFrom: new Date('2026-01-01'),
              status: 'ACTIVE',
              createdByMembershipId: session.membershipId,
            },
          });
        }
        await tx.mandatoryLeaveAssessment.create({
          data: {
            agencyId: session.agencyId,
            employeeId: employee.id,
            assessmentYear: 2026,
            assessmentDate: new Date('2026-06-30'),
            result: 'INDETERMINATE',
            materialFingerprint: `e2e-supervisor-${employee.id}`,
            inputFacts: { indeterminateReasons: ['MISSING_POLICY'] },
            ruleResults: [],
          },
        });
      }
    }),
  );

  const invitation = await apiBody<{ activationUrl: string }>(
    await page.request.post(`${agencyBase}/invitations`, {
      headers,
      data: { email: `supervisor-chief-${stamp}@example.test`, roleCodes: ['hrmo_administrator'] },
    }),
  );
  const supervisorPage = await (await browser.newContext()).newPage();
  await activateInvitation(supervisorPage, invitation.activationUrl, { name: chief.legalName });
  const own = await apiBody<{ membershipId: string }>(
    await supervisorPage.request.get('/api/v1/auth/me', {
      headers: { origin: new URL(supervisorPage.url()).origin },
    }),
  );
  // No API reassigns roles yet; hold the invitee to the Supervisor role.
  await withAdmin(async (admin) => {
    const role = await admin.role.findFirstOrThrow({
      where: { code: 'supervisor', agencyId: null },
    });
    await admin.membershipRole.updateMany({
      where: { membershipId: own.membershipId },
      data: { roleId: role.id },
    });
  });
  await apiBody(
    await page.request.post(`${agencyBase}/employees/${chief.id}/membership-link`, {
      headers,
      data: { membershipId: own.membershipId },
    }),
  );

  await supervisorPage.goto('/mandatory-leave?year=2026');
  await expect(
    supervisorPage.getByRole('heading', { level: 1, name: 'Mandatory Leave' }),
  ).toBeVisible();
  await expect(supervisorPage.getByRole('button', { name: /^Evaluate/ })).toHaveCount(0);
  const rows = supervisorPage.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText(report.employeeNumber);
  await expect(rows.nth(1)).toContainText('INDETERMINATE');
});
