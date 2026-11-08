import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { getConfig } from '@lingkod-hr/config';
import { expect, test, type APIResponse, type Browser, type Page } from '@playwright/test';
import { activateInvitation, MARISOL_EMAIL, signIn } from './sign-in';

interface MailpitMessagesResponse {
  messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }>;
}

/** COC credited to the journey's Employee before the request, in minutes. */
const CREDITED_MINUTES = 960;

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

/** Invite a User through Users & Access and activate them in their own browser. */
async function invite(
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

/** Give the Membership exactly these baseline roles, effective before today's route checks. */
async function setRoles(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
  roleCodes: string[],
): Promise<void> {
  await admin.membershipRole.deleteMany({ where: { agencyId, membershipId } });
  for (const code of roleCodes) {
    const role = await admin.role.findFirstOrThrow({
      where: { agencyId: null, code, status: 'ACTIVE' },
    });
    await admin.membershipRole.create({
      data: {
        agencyId,
        membershipId,
        roleId: role.id,
        effectiveFrom: new Date('2026-01-01T00:00:00+08:00'),
        reason: 'CTO Request workspace E2E fixture',
      },
    });
  }
}

/**
 * Let the Membership read its own Attendance Days, so the Employee opens their own DTR
 * preview. The baseline Employee role carries no Attendance read.
 */
async function grantOwnAttendanceRead(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
): Promise<void> {
  const code = 'e2e_own_attendance_reader';
  const role =
    (await admin.role.findFirst({ where: { agencyId, code } })) ??
    (await admin.role.create({
      data: { agencyId, code, name: 'E2E Own Attendance Reader', status: 'ACTIVE' },
    }));
  const permission = await admin.permission.findUniqueOrThrow({
    where: { code: 'attendance.days.read' },
  });
  await admin.rolePermission.createMany({
    data: [{ roleId: role.id, permissionId: permission.id, scopePolicy: 'OWN' }],
    skipDuplicates: true,
  });
  await admin.membershipRole.create({
    data: {
      agencyId,
      membershipId,
      roleId: role.id,
      effectiveFrom: new Date('2026-01-01T00:00:00+08:00'),
      reason: 'CTO Request workspace E2E fixture',
    },
  });
}

/**
 * An Organization Unit headed by the Supervisor, with the Employee serving in it on Alex
 * Rivera's ordinary schedule (08:00–17:00, Monday to Friday), so the Employee is the
 * Supervisor's direct report (ADR 0007). The Employee's COC is credited directly: earning
 * it has its own journey. A dedicated Employee keeps Alex Rivera's COC untouched for the
 * compensation journey.
 */
async function seedCtoJourney(
  admin: PrismaClient,
  agencyId: string,
  stamp: number,
  members: { employee: string; supervisor: string },
): Promise<{ employeeId: string; validUntil: string }> {
  const marisol = await admin.agencyMembership.findFirstOrThrow({
    where: { agencyId, user: { emailNormalized: MARISOL_EMAIL } },
    select: { id: true },
  });
  const alexAssignment = await admin.scheduleAssignment.findFirstOrThrow({
    where: { agencyId, employee: { employeeNumber: 'E2E-0001' } },
  });
  const earnedYear = new Date().getUTCFullYear();
  const validUntil = `${earnedYear + 1}-12-31`;
  return admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const by = { createdByMembershipId: marisol.id };
    const position = await transaction.plantillaPosition.create({
      data: {
        agencyId,
        itemNumber: `CTO-HEAD-${stamp}`,
        status: 'OCCUPIED',
        ...by,
        updatedByMembershipId: marisol.id,
      },
    });
    const unit = await transaction.organizationUnit.create({
      data: { agencyId, code: `CTO-${stamp}`, unitType: 'DIVISION', status: 'ACTIVE' },
    });
    const unitVersion = await transaction.organizationUnitVersion.create({
      data: {
        agencyId,
        organizationUnitId: unit.id,
        versionNo: 1,
        name: `CTO Journey Section ${stamp}`,
        headPositionId: position.id,
        effectiveFrom: new Date('2020-01-01'),
        status: 'ACTIVE',
        domainStatus: 'ACTIVE',
      },
    });
    await transaction.organizationUnit.update({
      where: { id: unit.id },
      data: { currentVersionId: unitVersion.id },
    });
    const person = async (label: string, membershipId: string, positionId: string | null) => {
      const employee = await transaction.employee.create({
        data: {
          agencyId,
          employeeNumber: `E2E-CTO-${label.toUpperCase()}-${stamp}`,
          legalName: `CTO ${label} ${stamp}`,
          birthDate: new Date('1990-01-01'),
          sex: 'FEMALE',
          civilStatus: 'SINGLE',
          contactEmail: `cto-${label.toLowerCase()}-${stamp}@example.test`,
          serviceStatus: 'ACTIVE',
          firstGovernmentServiceDate: new Date('2020-01-01'),
          agencyServiceStartDate: new Date('2020-01-01'),
          ...by,
          updatedByMembershipId: marisol.id,
        },
      });
      const segment = await transaction.serviceSegment.create({
        data: {
          agencyId,
          employeeId: employee.id,
          organizationUnitId: unit.id,
          positionId,
          appointmentStatus: 'PERMANENT',
          salaryGrade: 18,
          salaryStep: 1,
          effectiveFrom: new Date('2020-01-01'),
          status: 'ACTIVE',
          ...by,
        },
      });
      await transaction.employee.update({
        where: { id: employee.id },
        data: { currentServiceSegmentId: segment.id },
      });
      if (positionId) {
        await transaction.positionIncumbency.create({
          data: {
            agencyId,
            positionId,
            employeeId: employee.id,
            serviceSegmentId: segment.id,
            effectiveFrom: new Date('2020-01-01'),
            status: 'ACTIVE',
            ...by,
          },
        });
      }
      await transaction.agencyMembership.update({
        where: { id: membershipId },
        data: { employeeId: employee.id },
      });
      return employee.id;
    };
    await person('Supervisor', members.supervisor, position.id);
    const employeeId = await person('Employee', members.employee, null);
    await transaction.scheduleAssignment.create({
      data: {
        agencyId,
        employeeId,
        workScheduleVersionId: alexAssignment.workScheduleVersionId,
        workArrangementVersionId: alexAssignment.workArrangementVersionId,
        authorityDocumentVersionId: alexAssignment.authorityDocumentVersionId,
        effectiveFrom: new Date('2026-01-01'),
        assignedByMembershipId: marisol.id,
      },
    });
    const account = await transaction.cocAccount.create({
      data: { agencyId, employeeId, status: 'ACTIVE', openedAt: new Date('2026-01-01') },
    });
    await transaction.cocLedgerEntry.create({
      data: {
        agencyId,
        cocAccountId: account.id,
        minutes: CREDITED_MINUTES,
        // COC earned this January is valid until the end of next year (JC 2-A, s. 2005).
        effectiveDate: new Date(`${earnedYear}-02-01`),
        validUntil: new Date(validUntil),
        earnedMonth: new Date(`${earnedYear}-01-01`),
        sourceType: 'COC_EARNED_CERTIFICATE',
        sourceId: randomUUID(),
        sourcePostingKey: randomUUID(),
        ruleCode: 'E2E_FIXTURE',
        postedByMembershipId: marisol.id,
      },
    });
    return { employeeId, validUntil };
  });
}

/**
 * A Monday at least a week out, and the Tuesday after it, with no holiday on either:
 * consecutive Work Dates CTO can still be approved for.
 */
async function workDates(admin: PrismaClient, agencyId: string): Promise<[string, string]> {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  for (;;) {
    while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
    const monday = date.toISOString().slice(0, 10);
    const tuesday = new Date(date.getTime() + 86_400_000).toISOString().slice(0, 10);
    const holidays = await admin.holidayCalendarEntry.count({
      where: { agencyId, holidayDate: { in: [new Date(monday), new Date(tuesday)] } },
    });
    if (holidays === 0) return [monday, tuesday];
    date.setUTCDate(date.getUTCDate() + 1);
  }
}

function dateText(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

test('requests, recommends, and approves CTO, then shows it on the DTR preview', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, MARISOL_EMAIL, { fresh: true });
  await page.goto('/dashboard');
  const headers = { origin: new URL(page.url()).origin };

  const employee = await invite(browser, page, 'CTO Journey Employee');
  const supervisor = await invite(browser, page, 'CTO Journey Supervisor');
  const approver = await invite(browser, page, 'CTO Journey Approver');
  const agencyId = employee.agencyId;
  const agencyBase = `/api/v1/agencies/${agencyId}`;
  const stamp = Date.now();

  // Without overtime.coc.read, the destination is denied.
  await withAdmin((admin) => setRoles(admin, agencyId, employee.membershipId, []));
  await employee.page.goto('/cto-requests');
  await expect(
    employee.page.getByRole('heading', { name: 'You can’t open this page' }),
  ).toBeVisible();

  const { employeeId, validUntil, dates } = await withAdmin(async (admin) => {
    await setRoles(admin, agencyId, employee.membershipId, ['employee']);
    await grantOwnAttendanceRead(admin, agencyId, employee.membershipId);
    await setRoles(admin, agencyId, supervisor.membershipId, ['supervisor']);
    await setRoles(admin, agencyId, approver.membershipId, ['appointing_authority']);
    const seeded = await seedCtoJourney(admin, agencyId, stamp, {
      employee: employee.membershipId,
      supervisor: supervisor.membershipId,
    });
    return { ...seeded, dates: await workDates(admin, agencyId) };
  });
  const [monday, tuesday] = dates;

  // hris-controls §5.19: the Supervisor recommends, then the Approving Official decides.
  const route = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/approval-routes`, {
      headers,
      data: {
        routeCode: 'CTO_REQUEST',
        domain: 'OVERTIME',
        versionNo: 1,
        effectiveFrom: '2026-01-01',
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'overtime.cto.recommend',
              returnPermission: 'overtime.cto.return',
              assignment: { kind: 'SUBJECT_SUPERVISOR', roleCode: 'supervisor' },
              requiresSeparateReview: true,
            },
            {
              stepNo: 2,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'overtime.cto.return',
              approvePermission: 'overtime.cto.approve',
              rejectPermission: 'overtime.cto.reject',
              returnPermission: 'overtime.cto.return',
              assignment: { kind: 'MEMBERSHIP', membershipId: approver.membershipId },
              requiresSeparateReview: true,
            },
          ],
        },
      },
    }),
  );
  await apiBody(
    await page.request.post(`${agencyBase}/approval-routes/${route.id}/activate`, {
      headers,
      data: { reason: 'CTO Request route verified for the workspace journey.' },
    }),
  );

  // The Work Dates have Attendance Days, so the DTR preview has rows for CTO to cover.
  const calculated = await apiBody<{ period: { id: string } }>(
    await page.request.post(`${agencyBase}/attendance-days/calculate`, {
      headers,
      data: {
        periodCode: `E2E-CTO-${stamp}`,
        dateFrom: monday,
        dateTo: tuesday,
        employeeIds: [employeeId],
      },
    }),
  );

  // The Employee requests a whole day and a stated half day.
  const ui = employee.page;
  await ui.goto('/dashboard');
  const navigation = ui.getByRole('navigation', { name: 'Primary' });
  await navigation.getByRole('button', { name: 'Overtime', exact: true }).click();
  await navigation.getByRole('link', { name: 'CTO Requests', exact: true }).click();
  await expect(ui.getByText('No CTO Requests yet.')).toBeVisible();
  await ui.getByRole('button', { name: 'New CTO request' }).click();
  const form = ui.getByRole('form', { name: 'Request CTO' });
  const ownAvailable = form.getByRole('region', { name: 'Available COC for this request' });
  await expect(ownAvailable.getByRole('definition')).toHaveText(`${CREDITED_MINUTES} minutes`);
  await expect(ownAvailable).toContainText(
    `${CREDITED_MINUTES} minutes valid until ${dateText(validUntil)}`,
  );
  const first = form.getByRole('group', { name: 'Work Date 1' });
  await first.getByLabel('Work Date', { exact: true }).fill(monday);
  await form.getByRole('button', { name: 'Add Work Date' }).click();
  const second = form.getByRole('group', { name: 'Work Date 2' });
  await second.getByLabel('Work Date', { exact: true }).fill(tuesday);
  await second.getByLabel('Unit').selectOption('HALF');
  await second.getByLabel('Starts').fill('08:00');
  await second.getByLabel('Ends').fill('12:00');

  // A double click saves once, and so does Submit.
  const posts: string[] = [];
  ui.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/cto-requests'))
      posts.push(new URL(request.url()).pathname);
  });
  await form.getByRole('button', { name: 'Save draft' }).dblclick();
  await expect(
    ui.getByRole('status').filter({ hasText: 'The CTO Request was saved as a draft.' }),
  ).toBeVisible();
  expect(posts).toEqual([`${agencyBase}/cto-requests`]);
  const requestId = new URL(ui.url()).searchParams.get('record');
  if (!requestId) throw new Error('The saved CTO Request did not open in the Form.');
  const record = ui.getByRole('region', { name: 'CTO Request record' });
  const dateRow = (label: string) => record.getByRole('row').filter({ hasText: label });
  await expect(dateRow(dateText(monday)).locator('th, td')).toHaveText([
    dateText(monday),
    'Whole day',
    '480',
  ]);
  await expect(dateRow(dateText(tuesday)).locator('th, td')).toHaveText([
    dateText(tuesday),
    'Half day, 8:00 AM – 12:00 PM',
    '240',
  ]);
  await expect(record).toContainText('Awaiting Requester');

  await record.getByRole('button', { name: 'Submit request' }).dblclick();
  await expect(
    ui.getByRole('status').filter({ hasText: 'submitted for the Supervisor’s recommendation' }),
  ).toBeVisible();
  expect(posts.filter((path) => path.endsWith('/submit'))).toHaveLength(1);
  await expect(record).toContainText('Awaiting Supervisor');

  // A refusal shows the API's reason: the Work Date is already on a live request.
  await ui.getByRole('button', { name: 'New CTO request' }).click();
  await form
    .getByRole('group', { name: 'Work Date 1' })
    .getByLabel('Work Date', { exact: true })
    .fill(monday);
  await form.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    ui.getByRole('alert').filter({
      hasText: `${monday} is already on another of the Employee's CTO Requests.`,
    }),
  ).toBeVisible();

  // The Employee leaves the record open while it is decided.
  await ui.goto(`/cto-requests?view=form&record=${requestId}`);
  await expect(record.getByRole('button', { name: 'Withdraw request' })).toBeVisible();

  // The Supervisor finds it in the Tree. The Form shows its loading state.
  const supervisorUi = supervisor.page;
  await supervisorUi.goto('/cto-requests');
  const register = supervisorUi.getByRole('region', { name: 'CTO Request register' });
  await register.getByLabel('Search Employee').fill(`CTO Employee ${stamp}`);
  await expect(register.getByRole('row').filter({ hasText: 'Awaiting Supervisor' })).toBeVisible();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await supervisorUi.route(
    `**/cto-requests/${requestId}`,
    async (routed) => {
      await held;
      await routed.continue();
    },
    { times: 1 },
  );
  await register.getByRole('button', { name: `CTO Employee ${stamp}` }).click();
  await expect(supervisorUi.getByText('Loading the CTO Request…')).toBeVisible();
  release();
  const supervisorRecord = supervisorUi.getByRole('region', { name: 'CTO Request record' });
  await expect(
    supervisorRecord.getByRole('region', { name: `Available COC of CTO Employee ${stamp}` }),
  ).toContainText(`${CREDITED_MINUTES} minutes`);
  await supervisorRecord.getByLabel('Comment or reason').fill('The section can cover the dates.');
  await supervisorRecord.getByRole('button', { name: 'Recommend' }).click();
  await expect(
    supervisorUi.getByRole('status').filter({ hasText: 'recommended to the Approving Official' }),
  ).toBeVisible();
  await expect(supervisorRecord.getByRole('button', { name: 'Recommend' })).toHaveCount(0);

  // The Approving Official finds it on the Kanban, and approval posts at once.
  const approverUi = approver.page;
  await approverUi.goto('/cto-requests?view=kanban');
  const board = approverUi.getByRole('group', { name: 'CTO Request status board' });
  await board.getByRole('button', { name: new RegExp(`CTO Employee ${stamp}`) }).click();
  const approverRecord = approverUi.getByRole('region', { name: 'CTO Request record' });
  await expect(approverRecord).toContainText('For approval');
  await expect(approverRecord.getByRole('button', { name: /post/i })).toHaveCount(0);
  const approvals: string[] = [];
  approverUi.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/approve'))
      approvals.push(request.url());
  });
  await approverRecord.getByRole('button', { name: 'Approve' }).dblclick();
  await expect(
    approverUi.getByRole('status').filter({ hasText: 'The CTO Request was approved.' }),
  ).toBeVisible();
  expect(approvals).toHaveLength(1);
  await expect(approverRecord).toContainText('Approved');

  // Available COC is the API's, net of the approved future-dated use.
  const remaining = CREDITED_MINUTES - 480 - 240;
  const balance = await apiBody<{
    totalMinutes: string;
    available: { totalMinutes: string };
  }>(
    await approverUi.request.get(`${agencyBase}/employees/${employeeId}/coc-balance`, {
      headers: { origin: new URL(approverUi.url()).origin },
    }),
  );
  expect(balance.totalMinutes).toBe(`${CREDITED_MINUTES}.0`);
  expect(balance.available.totalMinutes).toBe(`${remaining}.0`);
  const approverAvailable = approverRecord.getByRole('region', {
    name: `Available COC of CTO Employee ${stamp}`,
  });
  await expect(approverAvailable.getByRole('definition')).toHaveText(`${remaining} minutes`);

  await approverRecord.getByRole('tab', { name: 'Decisions' }).click();
  const decisions = approverRecord.getByRole('list', { name: 'Decisions' });
  await expect(decisions.getByRole('listitem')).toHaveCount(2);
  await expect(decisions.getByRole('listitem').first()).toContainText('Recommended');
  await expect(decisions.getByRole('listitem').first()).toContainText(
    'The section can cover the dates.',
  );
  await expect(decisions.getByRole('listitem').last()).toContainText('Approved');
  await approverRecord.getByRole('tab', { name: 'Attendance' }).click();
  await expect(approverRecord.getByText('CTO input recorded in Attendance')).toHaveCount(2);

  // The Employee's open record is stale: Withdraw is refused, and Reload shows the decision.
  await record.getByRole('button', { name: 'Withdraw request' }).click();
  const stale = ui.getByRole('alert').filter({ hasText: 'changed since you opened it' });
  await expect(stale).toContainText('APPROVED');
  await stale.getByRole('button', { name: 'Reload' }).click();
  await expect(record).toContainText('Approved');
  await expect(record.getByRole('button', { name: 'Withdraw request' })).toHaveCount(0);

  // The approved CTO covers the Work Dates on the Employee's DTR preview.
  await ui.goto('/attendance-dtrs');
  await ui.getByRole('combobox', { name: /Attendance Period/ }).selectOption(calculated.period.id);
  const preview = ui.getByRole('region', { name: 'Unfinalized Daily Time Record Preview' });
  await expect(preview.getByRole('row').filter({ hasText: monday })).toContainText('CTO 8:00');
  await expect(preview.getByRole('row').filter({ hasText: tuesday })).toContainText('CTO 4:00');

  for (const person of [employee, supervisor, approver]) await person.page.context().close();
});
