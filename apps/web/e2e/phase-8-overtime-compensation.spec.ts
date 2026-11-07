import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { getConfig } from '@lingkod-hr/config';
import { expect, test, type APIResponse, type Browser, type Page } from '@playwright/test';
import { activateInvitation, MARISOL_EMAIL, signIn } from './sign-in';

interface MailpitMessagesResponse {
  messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }>;
}

interface CocBalance {
  cocAccountId: string | null;
  totalMinutes: string;
}

/** Work Dates in May 2026, a month no other overtime journey certifies service in. */
const WORK_DATE_FROM = '2026-05-11';
const WORK_DATE_TO = '2026-05-15';
const SERVICE = [
  { workDate: '2026-05-11', dayClassification: 'WORKDAY', certifiedMinutes: 90 },
  { workDate: '2026-05-12', dayClassification: 'REGULAR_HOLIDAY', certifiedMinutes: 60 },
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

/**
 * Invite an HR Administrator through Users & Access and activate them in their own browser.
 * Invitation grants start at activation; backdate them so Approval Route checks that read roles
 * at an earlier instant of the same day see them.
 */
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
  await withAdmin((admin) =>
    admin.membershipRole.updateMany({
      where: { membershipId: session.membershipId, effectiveTo: null },
      data: { effectiveFrom: new Date('2026-01-01T00:00:00+08:00') },
    }),
  );
  return { page: invitedPage, ...session };
}

/**
 * Give the Membership `overtime.coc_certificates.approve` Agency-wide. hris-controls §6.9 gives it
 * to the Approving Official (`A`); an Agency role carries it for this invited approver.
 */
async function grantCertificateApproval(
  admin: PrismaClient,
  agencyId: string,
  membershipId: string,
): Promise<void> {
  const code = 'e2e_coc_certificate_approver';
  const role =
    (await admin.role.findFirst({ where: { agencyId, code } })) ??
    (await admin.role.create({
      data: { agencyId, code, name: 'E2E COC Certificate Approver', status: 'ACTIVE' },
    }));
  const permission = await admin.permission.findUniqueOrThrow({
    where: { code: 'overtime.coc_certificates.approve' },
  });
  await admin.rolePermission.createMany({
    data: [{ roleId: role.id, permissionId: permission.id, scopePolicy: 'AGENCY' }],
    skipDuplicates: true,
  });
  await admin.membershipRole.create({
    data: {
      agencyId,
      membershipId,
      roleId: role.id,
      effectiveFrom: new Date('2026-01-01T00:00:00+08:00'),
      reason: 'Overtime compensation workspace E2E fixture',
    },
  });
}

/**
 * Two APPROVED authorities covering Alex Rivera: a COC one with two certified Work Dates, and an
 * overtime-pay one. Approval and certification have their own journeys; this one starts where
 * they end, so the records are written straight into their final state.
 */
async function seedCertifiedService(
  admin: PrismaClient,
  agencyId: string,
  authorityNo: { coc: string; pay: string },
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
  await admin.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    for (const [method, number] of [
      ['COC', authorityNo.coc],
      ['OVERTIME_PAY', authorityNo.pay],
    ] as const) {
      const authority = await transaction.overtimeAuthority.create({
        data: {
          agencyId,
          requestingUnitId: unitId,
          authorityNo: number,
          purpose: 'Inventory the May accessions.',
          workDateFrom: new Date(WORK_DATE_FROM),
          workDateTo: new Date(WORK_DATE_TO),
          compensationMethod: method,
          fundingReference: method === 'OVERTIME_PAY' ? 'GAA 2026 MOOE' : null,
          status: 'APPROVED',
          approvedByMembershipId: marisol.id,
          approvedAt: new Date('2026-05-04T09:00:00+08:00'),
        },
      });
      const coverage = await transaction.overtimeAuthorityEmployee.create({
        data: {
          agencyId,
          overtimeAuthorityId: authority.id,
          employeeId: employee.id,
          authorizedHours: '8',
        },
      });
      if (method !== 'COC') continue;
      for (const service of SERVICE) {
        await transaction.overtimeServiceRecord.create({
          data: {
            agencyId,
            overtimeAuthorityEmployeeId: coverage.id,
            employeeId: employee.id,
            workDate: new Date(service.workDate),
            claimedHours: '2',
            accomplishment: `Inventoried the accessions on ${service.workDate}.`,
            actualMinutes: 120,
            sourceAttendanceDayId: randomUUID(),
            dayClassification: service.dayClassification,
            status: 'CERTIFIED',
            certifiedMinutes: service.certifiedMinutes,
            recordedByMembershipId: marisol.id,
            certifiedByMembershipId: marisol.id,
            certifiedAt: new Date('2026-05-20T09:00:00+08:00'),
          },
        });
      }
    }
  });
}

async function openCompensation(page: Page, authorityNo: string): Promise<void> {
  await page.goto('/overtime-authorities');
  await page.getByLabel('Search authority, purpose, or Employee').fill(authorityNo);
  await page.getByRole('button', { name: authorityNo, exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: authorityNo })).toBeVisible();
  await page.getByRole('tab', { name: 'Compensation' }).click();
}

test('prepares and approves a Certificate of COC Earned and shows the COC balance', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, MARISOL_EMAIL, { fresh: true });
  await page.goto('/dashboard');
  const headers = { origin: new URL(page.url()).origin };

  const preparer = await inviteHrAdministrator(browser, page, 'COC Certificate Preparer');
  const approver = await inviteHrAdministrator(browser, page, 'COC Certificate Approver');
  const agencyBase = `/api/v1/agencies/${preparer.agencyId}`;
  const stamp = Date.now();
  const authorityNo = { coc: `OT-COC-${stamp}`, pay: `OT-PAY-${stamp}` };
  await withAdmin(async (admin) => {
    await grantCertificateApproval(admin, approver.agencyId, approver.membershipId);
    await seedCertifiedService(admin, preparer.agencyId, authorityNo);
  });

  // hris-controls, Certificate of COC Earned: the Head of Office grants it in one step.
  const route = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/approval-routes`, {
      headers,
      data: {
        routeCode: 'COC_EARNED_CERTIFICATE',
        domain: 'OVERTIME',
        versionNo: 1,
        effectiveFrom: '2026-01-01',
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'overtime.coc_certificates.approve',
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
      data: { reason: 'Certificate of COC Earned route verified for the workspace journey.' },
    }),
  );

  // Overtime pay shows as unavailable, in the API's words.
  const ui = preparer.page;
  const payReason = (
    await apiBody<{
      authorities: Array<{ authorityNo: string; overtimePayUnavailableReason: string }>;
    }>(
      await ui.request.get(`${agencyBase}/overtime-authorities`, {
        headers: { origin: new URL(ui.url()).origin },
      }),
    )
  ).authorities.find((row) => row.authorityNo === authorityNo.pay)?.overtimePayUnavailableReason;
  expect(payReason).toContain('Payroll');
  await openCompensation(ui, authorityNo.pay);
  await expect(ui.getByRole('note')).toHaveText(`Overtime pay is unavailable. ${payReason}`);
  await expect(ui.getByRole('button', { name: /Prepare certificate/ })).toHaveCount(0);

  // Before any certificate, the API reads a zero balance with no account.
  await openCompensation(ui, authorityNo.coc);
  const section = ui.getByRole('region', { name: 'Compensation of Alex Rivera' });
  const balance = section.getByRole('definition').first();
  await expect(balance).toHaveText('0 minutes');
  await expect(section).toContainText('No COC Account yet.');
  await expect(section).toContainText('No Certificate of COC Earned for these Work Dates.');

  // A double click prepares once.
  const posts: string[] = [];
  ui.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/coc-earned-certificates'))
      posts.push(request.url());
  });
  const prepare = section.getByRole('form', { name: 'Prepare a certificate for Alex Rivera' });
  await expect(prepare.getByLabel('Earned month')).toHaveValue('2026-05');
  await prepare.getByRole('button', { name: 'Prepare certificate for Alex Rivera' }).dblclick();
  await expect(
    ui.getByRole('status').filter({
      hasText: 'A Certificate of COC Earned for May 2026 was prepared for Alex Rivera.',
    }),
  ).toBeVisible();
  expect(posts).toHaveLength(1);

  const certificate = section.getByRole('article', {
    name: 'Certificate of COC Earned for May 2026',
  });
  await expect(certificate).toContainText('Draft');
  const line = (label: string) => certificate.getByRole('row').filter({ hasText: label });
  // Cells: Work Date, Day classification, Certified, Credited, Excess.
  await expect(line('May 11, 2026').locator('th, td')).toHaveText([
    'May 11, 2026',
    'Workday',
    '90',
    'Set at approval',
    '—',
  ]);
  await expect(line('May 12, 2026').locator('th, td').nth(2)).toHaveText('60');

  // A refusal shows its reason: the month's service is already on this draft.
  await prepare.getByRole('button', { name: 'Prepare certificate for Alex Rivera' }).click();
  await expect(
    ui.getByRole('alert').filter({
      hasText:
        'The Employee has no certified COC service in the month that is not on another certificate.',
    }),
  ).toBeVisible();

  await certificate
    .getByRole('button', { name: 'Submit the certificate for May 2026 for approval' })
    .click();
  await expect(
    ui.getByRole('status').filter({
      hasText: 'The certificate for May 2026 was submitted for approval.',
    }),
  ).toBeVisible();
  await expect(certificate).toContainText('For approval');
  // Approving is the Approving Official's; the preparer has no Approve action.
  await expect(certificate.getByRole('button', { name: /Approve/ })).toHaveCount(0);

  // The approver approves; a double click approves once.
  const approverUi = approver.page;
  const approvals: string[] = [];
  approverUi.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/approve'))
      approvals.push(request.url());
  });
  await openCompensation(approverUi, authorityNo.coc);
  const approverSection = approverUi.getByRole('region', { name: 'Compensation of Alex Rivera' });
  const approverCertificate = approverSection.getByRole('article', {
    name: 'Certificate of COC Earned for May 2026',
  });
  await approverCertificate
    .getByRole('button', { name: 'Approve the certificate for May 2026' })
    .dblclick();
  await expect(
    approverUi.getByRole('status').filter({
      hasText: 'The certificate for May 2026 was approved and its COC credited.',
    }),
  ).toBeVisible();
  expect(approvals).toHaveLength(1);
  await expect(approverCertificate).toContainText('Approved');
  const approvedLine = (label: string) =>
    approverCertificate.getByRole('row').filter({ hasText: label });
  // Credited minutes are the API's, after the 1.0 and 1.5 ratios.
  await expect(approvedLine('May 11, 2026').locator('th, td').nth(3)).toHaveText('90');
  await expect(approvedLine('May 11, 2026').locator('th, td').nth(4)).toHaveText('0');
  await expect(approvedLine('May 12, 2026').locator('th, td').nth(1)).toHaveText('Regular holiday');
  await expect(approvedLine('May 12, 2026').locator('th, td').nth(3)).toHaveText('90');

  // The balance shown is the API's derived balance.
  const derived = await apiBody<CocBalance>(
    await approverUi.request.get(
      `${agencyBase}/employees/${await withAdmin(
        async (admin) =>
          (
            await admin.employee.findFirstOrThrow({
              where: { agencyId: preparer.agencyId, employeeNumber: 'E2E-0001' },
              select: { id: true },
            })
          ).id,
      )}/coc-balance`,
      { headers: { origin: new URL(approverUi.url()).origin } },
    ),
  );
  expect(derived.cocAccountId).not.toBeNull();
  expect(derived.totalMinutes).toBe('180.0');
  await expect(approverSection.getByRole('definition').first()).toHaveText('180 minutes');
  await expect(approverSection).toContainText('180 minutes valid until Dec 31, 2027');

  // The preparer sees the same balance after reloading.
  await openCompensation(ui, authorityNo.coc);
  await expect(
    ui.getByRole('region', { name: 'Compensation of Alex Rivera' }).getByRole('definition').first(),
  ).toHaveText('180 minutes');

  await approverUi.context().close();
  await ui.context().close();
});
