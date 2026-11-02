import { PrismaClient } from '@prisma/client';
import { getConfig } from '@lingkod-hr/config';
import { expect, test, type APIResponse, type Browser, type Page } from '@playwright/test';
import { activateInvitation, MARISOL_EMAIL, signIn } from './sign-in';

interface MailpitMessagesResponse {
  messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }>;
}

const SERVICE_PERMISSIONS = [
  'overtime.service.record',
  'overtime.service.submit',
  'overtime.service.certify',
  'overtime.service.reject',
] as const;

/** Monday to Friday; Monday and Wednesday get locked Attendance, Tuesday none. */
const WORK_DATE_FROM = '2026-03-09';
const WORK_DATE_TO = '2026-03-13';
const LOCKED_DAYS = [
  { workDate: '2026-03-09', weekday: 1, outsideScheduleMinutes: 120 },
  { workDate: '2026-03-11', weekday: 3, outsideScheduleMinutes: 90 },
] as const;

async function apiBody<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return JSON.parse(text) as T;
}

async function readMailpitMessage(recipient: string, subject: string): Promise<string> {
  let messageId: string | null = null;
  await expect
    .poll(
      async () => {
        const response = await fetch('http://localhost:8025/api/v1/messages');
        if (!response.ok) throw new Error('Mailpit message listing failed.');
        const payload = (await response.json()) as MailpitMessagesResponse;
        const summary = payload.messages.find(
          (message) =>
            message.Subject === subject && message.To.some(({ Address }) => Address === recipient),
        );
        messageId = summary?.ID ?? null;
        return messageId !== null;
      },
      { intervals: [100], timeout: 5_000 },
    )
    .toBe(true);
  if (!messageId) throw new Error('The invitation message did not arrive in Mailpit.');
  const detailResponse = await fetch(`http://localhost:8025/api/v1/message/${messageId}`);
  if (!detailResponse.ok) throw new Error('Mailpit message lookup failed.');
  return ((await detailResponse.json()) as { Text: string }).Text;
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

/** Invite an HR Administrator through Users & Access and activate them in their own browser. */
async function inviteHrAdministrator(
  browser: Browser,
  page: Page,
  name: string,
): Promise<{ page: Page; agencyId: string; membershipId: string }> {
  const email = `${name.toLowerCase().replaceAll(' ', '-')}-${Date.now()}@example.test`;
  await page.goto('/users-access');
  await page.getByRole('button', { name: 'Invite user' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite user' });
  await dialog.getByLabel('Email address').fill(email);
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('status').first()).toContainText(`Invitation sent to ${email}`);
  const mailText = await readMailpitMessage(
    email,
    'LingkodHR invitation for National Archives Coordination Office',
  );
  const activationUrl = /https?:\/\/[^\s]+\/invite\/[A-Za-z0-9_-]{43}/.exec(mailText)?.[0];
  if (!activationUrl) throw new Error('The invitation email did not contain an activation link.');
  const context = await browser.newContext();
  const invitedPage = await context.newPage();
  await invitedPage.setViewportSize({ width: 1440, height: 900 });
  await activateInvitation(invitedPage, activationUrl, { name });
  const session = await apiBody<{ agencyId: string; membershipId: string }>(
    await invitedPage.request.get('/api/v1/auth/me', {
      headers: { origin: new URL(invitedPage.url()).origin },
    }),
  );
  return { page: invitedPage, ...session };
}

/**
 * Give the Membership the four service permissions Agency-wide. hris-controls §6.9 makes them
 * agency-configurable (`C`) for the HR Administrator, so an Agency role carries them.
 */
async function grantServicePermissions(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
): Promise<void> {
  const code = 'e2e_overtime_service_officer';
  const role =
    (await admin.role.findFirst({ where: { agencyId, code } })) ??
    (await admin.role.create({
      data: { agencyId, code, name: 'E2E Overtime Service Officer', status: 'ACTIVE' },
    }));
  const permissions = await admin.permission.findMany({
    where: { code: { in: [...SERVICE_PERMISSIONS] } },
  });
  await admin.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId: role.id,
      permissionId: permission.id,
      scopePolicy: 'AGENCY',
    })),
    skipDuplicates: true,
  });
  await admin.membershipRole.create({
    data: {
      agencyId,
      membershipId,
      roleId: role.id,
      effectiveFrom: new Date('2026-01-01T00:00:00+08:00'),
      reason: 'Overtime service workspace E2E fixture',
    },
  });
}

/**
 * An APPROVED authority covering Alex Rivera over one week in March, and locked Attendance for
 * two of its dates. Approval and Attendance locking have their own journeys; this one starts
 * where they end.
 */
async function seedApprovedAuthorityWithLockedAttendance(
  admin: PrismaClient,
  agencyId: string,
  authorityNo: string,
): Promise<void> {
  const employee = await admin.employee.findFirstOrThrow({
    where: { agencyId, employeeNumber: 'E2E-0001' },
    select: { id: true, currentServiceSegment: { select: { organizationUnitId: true } } },
  });
  const unitId = employee.currentServiceSegment?.organizationUnitId;
  if (!unitId) throw new Error('Alex Rivera has no current Service Segment.');
  const marisol = await admin.agencyMembership.findFirstOrThrow({
    where: { agencyId, user: { emailNormalized: MARISOL_EMAIL } },
    select: { id: true },
  });
  // The locked version's reviewer and locker must differ.
  const reviewer = await admin.agencyMembership.findFirstOrThrow({
    where: { agencyId, status: 'ACTIVE', id: { not: marisol.id } },
    select: { id: true },
  });
  const authority = await admin.overtimeAuthority.create({
    data: {
      agencyId,
      requestingUnitId: unitId,
      authorityNo,
      purpose: 'Digitize the March accession registers.',
      workDateFrom: new Date(WORK_DATE_FROM),
      workDateTo: new Date(WORK_DATE_TO),
      compensationMethod: 'COC',
      status: 'DRAFT',
    },
  });
  await admin.overtimeAuthorityEmployee.create({
    data: {
      agencyId,
      overtimeAuthorityId: authority.id,
      employeeId: employee.id,
      authorizedHours: '16',
    },
  });
  await admin.overtimeAuthority.update({
    where: { id: authority.id },
    data: {
      status: 'APPROVED',
      approvedByMembershipId: marisol.id,
      approvedAt: new Date('2026-03-02T09:00:00+08:00'),
    },
  });

  const assignment = await admin.scheduleAssignment.findFirstOrThrow({
    where: { agencyId, employeeId: employee.id },
    orderBy: { effectiveFrom: 'desc' },
  });
  const route = await admin.approvalRouteVersion.findFirstOrThrow({ where: { agencyId } });
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const period = await transaction.attendancePeriod.create({
      data: {
        agencyId,
        code: `E2E-OT-${authorityNo}`,
        dateFrom: new Date(WORK_DATE_FROM),
        dateTo: new Date(WORK_DATE_TO),
        status: 'FINALIZED',
      },
    });
    const submission = await transaction.employeeAttendanceSubmission.create({
      data: {
        agencyId,
        attendancePeriodId: period.id,
        employeeId: employee.id,
        versionNo: 1,
        status: 'APPROVED',
        submittedByMembershipId: marisol.id,
        submittedAt: new Date('2026-03-16T01:00:00.000Z'),
      },
    });
    const version = await transaction.attendancePeriodVersion.create({
      data: {
        agencyId,
        attendancePeriodId: period.id,
        versionNo: 1,
        status: 'LOCKED',
        approvalRouteVersionId: route.id,
        submittedByMembershipId: marisol.id,
        submittedAt: new Date('2026-03-16T02:00:00.000Z'),
        reviewedByMembershipId: reviewer.id,
        reviewedAt: new Date('2026-03-16T03:00:00.000Z'),
        reviewReason: 'Overtime service workspace fixture.',
        lockedByMembershipId: marisol.id,
        lockedAt: new Date('2026-03-16T04:00:00.000Z'),
        reconciliation: { source: 'E2E_OVERTIME_SERVICE_FIXTURE' },
      },
    });
    for (const locked of LOCKED_DAYS) {
      const rule = await transaction.workScheduleDayRule.findFirstOrThrow({
        where: {
          agencyId,
          workScheduleVersionId: assignment.workScheduleVersionId,
          weekday: locked.weekday,
        },
      });
      const day = await transaction.attendanceDay.create({
        data: {
          agencyId,
          attendancePeriodId: period.id,
          employeeId: employee.id,
          workDate: new Date(locked.workDate),
          scheduleAssignmentId: assignment.id,
          workScheduleVersionId: assignment.workScheduleVersionId,
          workArrangementVersionId: assignment.workArrangementVersionId,
          dayClassification: 'SCHEDULED',
          status: 'APPROVED',
          expectedMinutes: 480,
          workedMinutes: 480 + locked.outsideScheduleMinutes,
          coverageMinutes: 480,
          outsideScheduleMinutes: locked.outsideScheduleMinutes,
          calculationVersion: 1,
          ruleSnapshot: {
            timezone: 'Asia/Manila',
            assignmentId: assignment.id,
            workScheduleVersionId: assignment.workScheduleVersionId,
            workArrangementVersionId: assignment.workArrangementVersionId,
            dayRuleId: rule.id,
            holidayClassifications: {},
            eventIds: [],
            coverageSources: [],
            capturedAt: `${locked.workDate}T12:00:00.000Z`,
          },
          isCurrent: true,
          calculatedAt: new Date(`${locked.workDate}T12:00:00.000Z`),
        },
      });
      await transaction.employeeAttendanceSubmissionDay.create({
        data: {
          agencyId,
          employeeAttendanceSubmissionId: submission.id,
          attendanceDayId: day.id,
        },
      });
      await transaction.attendancePeriodVersionDay.create({
        data: {
          agencyId,
          attendancePeriodVersionId: version.id,
          employeeAttendanceSubmissionId: submission.id,
          attendanceDayId: day.id,
        },
      });
    }
  });
}

test('records, submits, certifies, and declines overtime service in the authority Form', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, MARISOL_EMAIL, { fresh: true });
  const officer = await inviteHrAdministrator(browser, page, 'Overtime Service Officer');
  const authorityNo = `OT-SVC-${Date.now()}`;
  await withAdmin(async (admin) => {
    await grantServicePermissions(admin, officer.agencyId, officer.membershipId);
    await seedApprovedAuthorityWithLockedAttendance(admin, officer.agencyId, authorityNo);
  });

  const ui = officer.page;
  await ui.goto('/overtime-authorities');
  await ui.getByLabel('Search authority, purpose, or Employee').fill(authorityNo);
  await ui.getByRole('button', { name: authorityNo, exact: true }).click();
  await expect(ui.getByRole('heading', { level: 2, name: authorityNo })).toBeVisible();
  await ui.getByRole('tab', { name: 'Service' }).click();

  const group = ui.getByRole('region', { name: 'Service of Alex Rivera' });
  const totals = (label: string) =>
    group.locator('dl > div').filter({ has: ui.getByText(label, { exact: true }) });
  await expect(totals('Authorized hours')).toContainText('16');
  await expect(totals('Certified minutes')).toContainText('0');
  await expect(totals('Remaining minutes')).toContainText('960');
  await expect(group.getByText('No service recorded.')).toBeVisible();
  for (const header of [
    'Claimed hours',
    'Actual minutes (locked Attendance)',
    'Certified minutes',
  ]) {
    await expect(group.getByRole('columnheader', { name: header })).toHaveCount(0);
  }

  // Record three dates: two with locked Attendance, one without.
  const record = async (workDate: string, label: string, hours: string) => {
    await group.getByRole('button', { name: 'Record service for Alex Rivera' }).click();
    const form = group.getByRole('form', { name: 'Record service for Alex Rivera' });
    await form.getByLabel('Work Date').fill(workDate);
    await form.getByLabel('Claimed hours').fill(hours);
    await form.getByLabel('Accomplishment').fill(`Digitized the registers on ${label}.`);
    await form.getByRole('button', { name: 'Record service' }).click();
    await expect(
      ui.getByRole('status').filter({
        hasText: `Service on ${label} was recorded for Alex Rivera.`,
      }),
    ).toBeVisible();
  };
  await record('2026-03-09', 'Mar 9, 2026', '2.5');
  await record('2026-03-10', 'Mar 10, 2026', '1');
  await record('2026-03-11', 'Mar 11, 2026', '1.5');

  for (const header of [
    'Claimed hours',
    'Actual minutes (locked Attendance)',
    'Certified minutes',
  ]) {
    await expect(group.getByRole('columnheader', { name: header })).toBeVisible();
  }
  const row = (label: string) => group.getByRole('row').filter({ hasText: label }).first();
  // Cells: Work Date, Status, Claimed, Actual, Certified, Accomplishment, Actions.
  const cell = (label: string, index: number) => row(label).locator('th, td').nth(index);
  await expect(cell('Mar 9, 2026', 1)).toHaveText('Rendered');
  await expect(cell('Mar 9, 2026', 2)).toHaveText('2.5');
  await expect(cell('Mar 9, 2026', 3)).toHaveText('Read on submission');

  // A date without locked Attendance says why it can't be submitted, in the API's words.
  await expect(row('Mar 10, 2026')).toContainText(
    'Can’t submit: Attendance for 2026-03-10 is not locked yet, so its Actual Overtime Hours are not known.',
  );
  await expect(
    row('Mar 10, 2026').getByRole('button', { name: 'Submit service on Mar 10, 2026' }),
  ).toBeDisabled();

  // A double click submits once.
  const submits: string[] = [];
  ui.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/submit'))
      submits.push(request.url());
  });
  await row('Mar 9, 2026')
    .getByRole('button', { name: 'Submit service on Mar 9, 2026 for certification' })
    .dblclick();
  await expect(
    ui.getByRole('status').filter({
      hasText: 'The service on Mar 9, 2026 was submitted for certification.',
    }),
  ).toBeVisible();
  expect(submits).toHaveLength(1);
  await expect(cell('Mar 9, 2026', 1)).toHaveText('For certification');
  await expect(cell('Mar 9, 2026', 3)).toHaveText('120');
  await expect(cell('Mar 9, 2026', 4)).toHaveText('—');

  // A refusal shows its reason: certified time can't exceed actual time.
  await row('Mar 9, 2026').getByRole('button', { name: 'Certify service on Mar 9, 2026' }).click();
  const certify = group.getByRole('form', { name: 'Certify service on Mar 9, 2026' });
  await expect(certify).toContainText('Actual minutes from locked Attendance: 120');
  await certify.getByLabel('Certified minutes, net of breaks').fill('150');
  await certify.getByRole('button', { name: 'Certify service' }).click();
  await expect(
    ui.getByRole('alert').filter({
      hasText: 'Certified time of 150 minutes exceeds the 120 actual minutes.',
    }),
  ).toBeVisible();
  await certify.getByLabel('Certified minutes, net of breaks').fill('90');
  await certify.getByRole('button', { name: 'Certify service' }).click();
  await expect(
    ui.getByRole('status').filter({ hasText: 'The service on Mar 9, 2026 was certified.' }),
  ).toBeVisible();
  await expect(cell('Mar 9, 2026', 1)).toHaveText('Certified');
  await expect(cell('Mar 9, 2026', 2)).toHaveText('2.5');
  await expect(cell('Mar 9, 2026', 3)).toHaveText('120');
  await expect(cell('Mar 9, 2026', 4)).toHaveText('90');
  await expect(totals('Certified minutes')).toContainText('90');
  await expect(totals('Remaining minutes')).toContainText('870');

  // Submit the other locked date, then decline it with a reason.
  await row('Mar 11, 2026')
    .getByRole('button', { name: 'Submit service on Mar 11, 2026 for certification' })
    .click();
  await expect(cell('Mar 11, 2026', 3)).toHaveText('90');
  await row('Mar 11, 2026')
    .getByRole('button', { name: 'Decline service on Mar 11, 2026' })
    .click();
  const decline = group.getByRole('form', { name: 'Decline service on Mar 11, 2026' });
  await decline.getByLabel('Decline reason').fill('The registers were digitized in regular hours.');
  await decline.getByRole('button', { name: 'Decline certification' }).click();
  await expect(
    ui.getByRole('status').filter({
      hasText: 'Certification of the service on Mar 11, 2026 was declined.',
    }),
  ).toBeVisible();
  await expect(cell('Mar 11, 2026', 1)).toHaveText('Not certified');
  await expect(row('Mar 11, 2026')).toContainText(
    'Declined: The registers were digitized in regular hours.',
  );
  await expect(cell('Mar 11, 2026', 4)).toHaveText('—');
  // Declining leaves the certified total alone.
  await expect(totals('Certified minutes')).toContainText('90');

  // A refusal reloads the register: a record declined elsewhere shows as declined, without Certify.
  await group.getByRole('button', { name: 'Record service for Alex Rivera' }).click();
  const again = group.getByRole('form', { name: 'Record service for Alex Rivera' });
  await again.getByLabel('Work Date').fill('2026-03-11');
  await again.getByLabel('Claimed hours').fill('1');
  await again.getByLabel('Accomplishment').fill('Indexed the March registers.');
  await again.getByRole('button', { name: 'Record service' }).click();
  const second = group.getByRole('row').filter({ hasText: 'Indexed the March registers.' });
  await second
    .getByRole('button', { name: 'Submit service on Mar 11, 2026 for certification' })
    .click();
  await expect(second.locator('th, td').nth(1)).toHaveText('For certification');
  await withAdmin((admin) =>
    admin.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.overtimeServiceRecord.updateMany({
        where: { agencyId: officer.agencyId, accomplishment: 'Indexed the March registers.' },
        data: { status: 'NOT_CERTIFIED', declineReason: 'Declined in another session.' },
      });
    }),
  );
  await second.getByRole('button', { name: 'Certify service on Mar 11, 2026' }).click();
  const stale = group.getByRole('form', { name: 'Certify service on Mar 11, 2026' });
  await stale.getByLabel('Certified minutes, net of breaks').fill('60');
  await stale.getByRole('button', { name: 'Certify service' }).click();
  await expect(
    ui.getByRole('alert').filter({
      hasText:
        'Only a FOR_CERTIFICATION Overtime Service Record can be certified; this one is NOT_CERTIFIED.',
    }),
  ).toBeVisible();
  await expect(second.locator('th, td').nth(1)).toHaveText('Not certified');
  await expect(second).toContainText('Declined: Declined in another session.');
  await expect(second.getByRole('button', { name: 'Certify service on Mar 11, 2026' })).toHaveCount(
    0,
  );

  await ui.context().close();
});
