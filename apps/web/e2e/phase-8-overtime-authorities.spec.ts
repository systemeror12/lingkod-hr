import { PrismaClient } from '@prisma/client';
import { getConfig } from '@lingkod-hr/config';
import { expect, test, type APIResponse, type Browser, type Page } from '@playwright/test';
import { activateInvitation, MARISOL_EMAIL, signIn } from './sign-in';

interface MailpitMessagesResponse {
  messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }>;
}

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
 * Invite an HR Administrator through Users & Access and activate them in their own browser
 * context. Invitation grants start at activation; backdate them so Approval Route checks that
 * read roles at an earlier instant of the same day see them.
 */
async function inviteHrAdministrator(
  browser: Browser,
  page: Page,
  name: string,
): Promise<{ page: Page; membershipId: string }> {
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
  const session = await apiBody<{ membershipId: string }>(
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
  return { page: invitedPage, membershipId: session.membershipId };
}

/** The workspace's own status line; the shell announces other statuses too. */
async function expectStatus(page: Page, text: string): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();
}

/** Prepare one draft through the Form, covering Alex Rivera. */
async function prepareDraft(page: Page, authorityNo: string, hours: string): Promise<void> {
  await page.goto('/overtime-authorities');
  await page.getByRole('button', { name: 'New authority' }).click();
  const form = page.getByRole('region', { name: 'Prepare Overtime Authority' });
  await form.getByLabel('Authority number').fill(authorityNo);
  await form.getByLabel('Requesting unit').selectOption({ index: 1 });
  await form.getByLabel('Purpose').fill('Year-end closing of the Agency accounts.');
  await form.getByLabel('First Work Date').fill('2026-12-14');
  await form.getByLabel('Last Work Date').fill('2026-12-18');
  await form.getByLabel('Employee 1').selectOption({ label: 'Alex Rivera (E2E-0001)' });
  await form.getByLabel('Authorized hours 1').fill(hours);
  await form.getByLabel('Task 1 (optional)').fill('Reconcile the ledgers.');
  await form.getByRole('button', { name: 'Save draft' }).click();
  await expectStatus(page, 'The Overtime Authority was saved as a draft.');
  await expect(page.getByRole('heading', { level: 2, name: authorityNo })).toBeVisible();
}

async function openFromTree(page: Page, authorityNo: string): Promise<void> {
  await page.goto('/overtime-authorities');
  await page.getByLabel('Search authority, purpose, or Employee').fill(authorityNo);
  await page.getByRole('button', { name: authorityNo, exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: authorityNo })).toBeVisible();
}

test('prepares, submits, reviews, approves, and rejects Overtime Authorities', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, MARISOL_EMAIL, { fresh: true });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
  const headers = { origin: new URL(page.url()).origin };
  const session = await apiBody<{ agencyId: string; membershipId: string }>(
    await page.request.get('/api/v1/auth/me', { headers }),
  );
  const agencyBase = `/api/v1/agencies/${session.agencyId}`;

  // hris-controls §5.16: one Approving Official decides; Marisol holds that role.
  const route = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/approval-routes`, {
      headers,
      data: {
        routeCode: 'OVERTIME_AUTHORITY',
        domain: 'OVERTIME',
        versionNo: 1,
        effectiveFrom: '2026-01-01',
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'overtime.authorities.approve',
              rejectPermission: 'overtime.authorities.reject',
              assignment: { kind: 'MEMBERSHIP', membershipId: session.membershipId },
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
      data: { reason: 'Overtime Authority route verified for the workspace journey.' },
    }),
  );

  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await navigation.getByRole('button', { name: 'Overtime', exact: true }).click();
  await expect(
    navigation.getByRole('link', { name: 'Overtime Authorities', exact: true }),
  ).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'COC Accounts' })).toHaveCount(0);

  const preparer = await inviteHrAdministrator(browser, page, 'Overtime Preparer');
  const reviewer = await inviteHrAdministrator(browser, page, 'Overtime Reviewer');
  const stamp = Date.now();
  const approvedNo = `OT-E2E-${stamp}-A`;
  const rejectedNo = `OT-E2E-${stamp}-R`;
  const staleNo = `OT-E2E-${stamp}-S`;

  // Prepare and submit. A double click submits once.
  await prepareDraft(preparer.page, approvedNo, '12');
  const preparerRecord = preparer.page.getByRole('region', { name: 'Overtime Authority record' });
  await expect(preparerRecord).toContainText('Awaiting Preparer');
  await expect(preparerRecord.getByRole('region', { name: 'Covered Employees' })).toContainText(
    'Taken when the authority is approved.',
  );
  await preparerRecord.getByRole('button', { name: 'Submit for review' }).dblclick();
  await expectStatus(preparer.page, 'The authority was submitted for review.');
  await expect(preparerRecord).toContainText('Awaiting Reviewer');
  await preparerRecord.getByRole('tab', { name: 'History' }).click();
  await expect(
    preparerRecord.getByRole('list', { name: 'Authority history' }).getByRole('listitem'),
  ).toHaveCount(2);
  await preparerRecord.getByRole('tab', { name: 'Authority' }).click();

  // The preparer holds the review permission, but the API refuses and the form shows why.
  await preparerRecord
    .getByLabel('Position level, Alex Rivera')
    .selectOption('DIVISION_CHIEF_OR_BELOW');
  await preparerRecord.getByLabel('No other beyond-hours allowance, Alex Rivera').check();
  await preparerRecord.getByRole('button', { name: 'Record review' }).click();
  await expect(
    preparer.page.getByRole('alert').filter({
      hasText: 'Nobody may review or approve an Overtime Authority they prepared or submitted.',
    }),
  ).toBeVisible();

  // Review by another HR Administrator.
  await openFromTree(reviewer.page, approvedNo);
  const reviewerRecord = reviewer.page.getByRole('region', { name: 'Overtime Authority record' });
  const recordReview = reviewerRecord.getByRole('button', { name: 'Record review' });
  await expect(recordReview).toBeDisabled();
  await reviewerRecord
    .getByLabel('Position level, Alex Rivera')
    .selectOption('DIVISION_CHIEF_OR_BELOW');
  await reviewerRecord.getByLabel('No other beyond-hours allowance, Alex Rivera').check();
  await recordReview.click();
  await expectStatus(reviewer.page, 'The review was recorded');
  await expect(reviewerRecord).toContainText('Awaiting Approving Official · Marisol Santos');
  await expect(reviewerRecord.getByRole('region', { name: 'Review' })).toContainText(
    'Reviewed by Overtime Reviewer',
  );
  // An HR Administrator holds no baseline approve or reject grant, so no decision controls show.
  await expect(reviewerRecord.getByRole('button', { name: 'Approve authority' })).toHaveCount(0);
  await expect(reviewerRecord.getByRole('button', { name: 'Reject authority' })).toHaveCount(0);

  // Approve as the Approving Official, reaching the record from the Kanban board.
  await page.goto('/overtime-authorities?view=kanban');
  const board = page.getByRole('group', { name: 'Overtime Authority status board' });
  await board.getByRole('button', { name: new RegExp(approvedNo) }).click();
  const record = page.getByRole('region', { name: 'Overtime Authority record' });
  await expect(record.getByRole('heading', { level: 2, name: approvedNo })).toBeVisible();
  await record.getByLabel('Approval comments (optional)').fill('Necessary for the closing.');
  await record.getByRole('button', { name: 'Approve authority' }).click();
  await expectStatus(page, 'The authority was approved.');
  await expect(record).toContainText('Approved');
  await expect(record.getByRole('region', { name: 'Decision' })).toContainText(
    'Necessary for the closing.',
  );
  const covered = record.getByRole('region', { name: 'Covered Employees' });
  await expect(covered).toContainText('12');
  await expect(covered).toContainText('Attested: Division chief or below');
  await expect(record.getByRole('button', { name: 'Approve authority' })).toHaveCount(0);
  await expect(record.getByRole('button', { name: 'Cancel authority' })).toBeVisible();

  // Only the Approving Official cancels an approved authority, so an HR Administrator, who holds
  // cancel without approve, sees no Cancel on it.
  await openFromTree(reviewer.page, approvedNo);
  await expect(reviewerRecord).toContainText('Approved');
  await expect(reviewerRecord.getByRole('button', { name: 'Cancel authority' })).toHaveCount(0);

  // Reject a second authority with its reason.
  await prepareDraft(preparer.page, rejectedNo, '6');
  await preparerRecord.getByRole('button', { name: 'Submit for review' }).click();
  await expect(preparerRecord).toContainText('Awaiting Reviewer');
  await openFromTree(reviewer.page, rejectedNo);
  await reviewerRecord
    .getByLabel('Position level, Alex Rivera')
    .selectOption('OIC_OF_HIGHER_POSITION');
  await reviewerRecord.getByLabel('No other beyond-hours allowance, Alex Rivera').check();
  await reviewerRecord.getByRole('button', { name: 'Record review' }).click();
  await expect(reviewerRecord).toContainText('Awaiting Approving Official');
  await openFromTree(page, rejectedNo);
  const reject = record.getByRole('button', { name: 'Reject authority' });
  await expect(reject).toBeDisabled();
  await record.getByLabel('Rejection reason').fill('The closing is covered by regular hours.');
  await reject.click();
  await expectStatus(page, 'The authority was rejected.');
  await expect(record.getByRole('region', { name: 'Decision' })).toContainText(
    'The closing is covered by regular hours.',
  );
  await record.getByRole('tab', { name: 'History' }).click();
  await expect(record.getByRole('list', { name: 'Authority history' })).toContainText(
    'Reason: The closing is covered by regular hours.',
  );

  // The Tree filters by status and shows the authorized hours.
  await page.goto('/overtime-authorities');
  await page.getByLabel('Search authority, purpose, or Employee').fill(`OT-E2E-${stamp}`);
  await page.getByLabel('Status').selectOption('APPROVED');
  const rows = page.getByRole('row').filter({ hasText: `OT-E2E-${stamp}` });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(approvedNo);
  await expect(rows).toContainText('COC');

  // A stale draft: submitted elsewhere after it was opened.
  const preparerHeaders = { origin: new URL(preparer.page.url()).origin };
  const register = await apiBody<{
    authorities: Array<{
      authorityNo: string;
      requestingUnitId: string;
      employees: Array<{ employeeId: string }>;
    }>;
  }>(
    await preparer.page.request.get(`${agencyBase}/overtime-authorities`, {
      headers: preparerHeaders,
    }),
  );
  const approvedRecord = register.authorities.find(({ authorityNo }) => authorityNo === approvedNo);
  if (!approvedRecord) throw new Error('The approved authority is missing from the register.');
  const staleDraft = await apiBody<{ id: string }>(
    await preparer.page.request.post(`${agencyBase}/overtime-authorities`, {
      headers: preparerHeaders,
      data: {
        authorityNo: staleNo,
        requestingUnitId: approvedRecord.requestingUnitId,
        purpose: 'Records digitization backlog.',
        workDateFrom: '2026-12-21',
        workDateTo: '2026-12-21',
        compensationMethod: 'COC',
        employees: approvedRecord.employees.map(({ employeeId }) => ({
          employeeId,
          authorizedHours: '4',
        })),
      },
    }),
  );
  await openFromTree(preparer.page, staleNo);
  await apiBody(
    await preparer.page.request.post(`${agencyBase}/overtime-authorities/${staleDraft.id}/submit`, {
      headers: preparerHeaders,
    }),
  );
  await preparerRecord.getByRole('button', { name: 'Submit for review' }).click();
  const staleNotice = preparerRecord.getByRole('alert');
  await expect(staleNotice).toContainText(
    'This Overtime Authority changed since you opened it. Only a DRAFT Overtime Authority can be changed; this one is SUBMITTED.',
  );
  await expect(preparerRecord.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
  await staleNotice.getByRole('button', { name: 'Reload' }).click();
  await expect(preparerRecord).toContainText('Awaiting Reviewer');
  await expect(preparerRecord.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);

  await preparer.page.context().close();
  await reviewer.page.context().close();
});

test('denies the workspace to a Membership without the read permission', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  // The seeded Context Reader holds only the Payroll Preparer role, which §6.9 gives no read.
  await signIn(page, 'context.reader@example.test');
  await page.goto('/overtime-authorities');
  await expect(page.getByRole('heading', { name: 'You can’t open this page' })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'Overtime', exact: true }),
  ).toHaveCount(0);
});
