import { PrismaClient } from '@prisma/client';
import { getConfig } from '@lingkod-hr/config';
import {
  expect,
  test,
  type APIResponse,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';
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

/** Let the browser finish rendering what already arrived, so an absence means something. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}

/** The workspace's own status line; the shell announces other statuses too. */
async function expectStatus(page: Page, text: string): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();
}

/** Prepare one draft through the Form, covering Alex Rivera. */
async function prepareDraft(page: Page, authorityNo: string, hours: string): Promise<void> {
  const form = await fillDraft(page, authorityNo, hours);
  await form.getByRole('button', { name: 'Save draft' }).click();
  await expectStatus(page, 'The Overtime Authority was saved as a draft.');
  await expect(page.getByRole('heading', { level: 2, name: authorityNo })).toBeVisible();
}

async function fillDraft(page: Page, authorityNo: string, hours: string): Promise<Locator> {
  await page.goto('/overtime-authorities');
  return fillNewDraft(page, authorityNo, hours);
}

/** Open the prepare form from the workspace already on screen and fill it in. */
async function fillNewDraft(page: Page, authorityNo: string, hours: string): Promise<Locator> {
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
  return form;
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
  await expect(record).toContainText('Proposed method');
  await expect(record).not.toContainText('Approved method');
  await expect(record.getByRole('region', { name: 'Covered Employees' })).toContainText(
    'Not taken; the authority was not approved.',
  );
  await expect(record).not.toContainText('Taken when the authority is approved.');
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

  // A Form deep link starts out loading: the first paint never claims nothing is selected.
  const deepLink = `/overtime-authorities?view=form&record=${approvedRecord.id}`;
  const firstPaint = await (await page.request.get(deepLink)).text();
  expect(firstPaint).toContain('Loading the Overtime Authority');
  expect(firstPaint).not.toContain('Select an Overtime Authority');
  await page.goto(deepLink);
  await expect(record.getByRole('heading', { level: 2, name: approvedNo })).toBeVisible();
  await expect(record).not.toContainText('Select an Overtime Authority');

  // Back during a record's load leaves no spinner behind.
  const detailUrl = `**/overtime-authorities/${approvedRecord.id}`;
  await page.route(detailUrl, () => undefined);
  await page.goto('/overtime-authorities');
  await page.getByLabel('Search authority, purpose, or Employee').fill(approvedNo);
  const detailRequest = page.waitForRequest(`**/overtime-authorities/${approvedRecord.id}`);
  await page.getByRole('button', { name: approvedNo, exact: true }).click();
  await detailRequest;
  await page.goBack();
  await page.getByRole('tab', { name: 'Form' }).click();
  await expect(record).toContainText('Select an Overtime Authority');
  await expect(record).not.toContainText('Loading the Overtime Authority');
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // Two drafts open side by side, to move from one to the other while a request is in flight.
  const draftBody = (authorityNo: string) => ({
    headers: preparerHeaders,
    data: {
      authorityNo,
      requestingUnitId: approvedRecord.requestingUnitId,
      purpose: 'Records digitization backlog.',
      workDateFrom: '2026-12-22',
      workDateTo: '2026-12-22',
      compensationMethod: 'COC',
      employees: approvedRecord.employees.map(({ employeeId }) => ({
        employeeId,
        authorizedHours: '4',
      })),
    },
  });
  const firstNo = `OT-E2E-${stamp}-FIRST`;
  const secondNo = `OT-E2E-${stamp}-SECOND`;
  await apiBody(
    await preparer.page.request.post(`${agencyBase}/overtime-authorities`, draftBody(firstNo)),
  );
  const second = await apiBody<{ id: string }>(
    await preparer.page.request.post(`${agencyBase}/overtime-authorities`, draftBody(secondNo)),
  );
  const staleRefusal = {
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({
      error: { code: 'OVERTIME_AUTHORITY_NOT_DRAFT', message: 'Refused for the other authority.' },
    }),
  };
  const submitButton = record.getByRole('button', { name: 'Submit for review' });
  const submitUrl = `**/overtime-authorities/${second.id}/submit`;
  const secondDetailUrl = `**/overtime-authorities/${second.id}`;
  const openSecond = async () => {
    await page.goto('/overtime-authorities');
    await page.getByLabel('Search authority, purpose, or Employee').fill(`OT-E2E-${stamp}-`);
    await page.getByRole('button', { name: secondNo, exact: true }).click();
    await expect(record.getByRole('heading', { level: 2, name: secondNo })).toBeVisible();
  };

  // A reload of one record failing after the user moved on leaves the next record loaded.
  await openSecond();
  await page.route(submitUrl, (route) => route.fulfill(staleRefusal));
  await submitButton.click();
  const banner = record.getByRole('alert');
  await expect(banner).toContainText('Refused for the other authority.');
  await page.unroute(submitUrl);

  // Choosing the same record in the Tree refetches nothing, so the banner and its lock stay.
  await page.getByRole('tab', { name: 'Tree' }).click();
  await page.getByRole('button', { name: secondNo, exact: true }).click();
  await expect(record.getByRole('heading', { level: 2, name: secondNo })).toBeVisible();
  await expect(banner).toContainText('Refused for the other authority.');
  await expect(submitButton).toBeDisabled();

  let failReload = (): void => undefined;
  await page.route(secondDetailUrl, async (route) => {
    await new Promise<void>((resolve) => {
      failReload = resolve;
    });
    await route.abort();
  });
  const reloadRequest = page.waitForRequest(secondDetailUrl);
  await record.getByRole('button', { name: 'Reload' }).click();
  await reloadRequest;
  await record.getByRole('button', { name: 'Next' }).click();
  await expect(record.getByRole('heading', { level: 2, name: firstNo })).toBeVisible();
  const reloadFailed = page.waitForEvent('requestfailed');
  failReload();
  await reloadFailed;
  await settle(page);
  await expect(record.getByRole('heading', { level: 2, name: firstNo })).toBeVisible();
  await expect(record).not.toContainText('Loading the Overtime Authority');
  await page.unroute(secondDetailUrl);

  // A command's result stays with its record: neither its refusal nor its success shows on the next.
  await openSecond();
  let releaseSubmit = (): void => undefined;
  await page.route(submitUrl, async (route) => {
    await new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    await route.fulfill(staleRefusal);
  });
  const submitRequest = page.waitForRequest(submitUrl);
  await submitButton.click();
  await submitRequest;
  await record.getByRole('button', { name: 'Next' }).click();
  await expect(record.getByRole('heading', { level: 2, name: firstNo })).toBeVisible();
  const refused = page.waitForResponse(submitUrl);
  releaseSubmit();
  await refused;
  // Actions stay disabled until the command settles, and a refusal shown here would keep them so.
  await expect(submitButton).toBeEnabled();
  await expect(record.getByRole('alert')).toHaveCount(0);
  await page.unroute(submitUrl);

  // Coming back through the Form's own control shows the refusal it held for this record.
  await record.getByRole('button', { name: 'Previous' }).click();
  await expect(record.getByRole('heading', { level: 2, name: secondNo })).toBeVisible();
  await expect(record.getByRole('alert')).toContainText('Refused for the other authority.');

  await openSecond();
  await page.route(submitUrl, async (route) => {
    await new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    await route.continue();
  });
  const secondSubmit = page.waitForRequest(submitUrl);
  await submitButton.click();
  await secondSubmit;
  await record.getByRole('button', { name: 'Next' }).click();
  await expect(record.getByRole('heading', { level: 2, name: firstNo })).toBeVisible();
  const refreshed = page.waitForResponse(secondDetailUrl);
  releaseSubmit();
  await refreshed;
  await expect(submitButton).toBeEnabled();
  await expect(page.getByRole('status').filter({ hasText: 'submitted for review' })).toHaveCount(0);
  await page.unroute(submitUrl);

  // Cancel is final, so it asks first: dismissing sends nothing, accepting cancels.
  const cancels: string[] = [];
  page.on('request', (sent) => {
    if (sent.url().endsWith('/cancel')) cancels.push(sent.url());
  });
  const cancelButton = record.getByRole('button', { name: 'Cancel authority' });
  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.dismiss();
  });
  await cancelButton.click();
  await settle(page);
  expect(asked).toContain(firstNo);
  expect(asked).toContain('can’t be undone');
  expect(cancels).toHaveLength(0);
  await expect(record.getByRole('heading', { level: 2, name: firstNo })).toBeVisible();
  await expect(record).not.toContainText('Cancelled');

  page.once('dialog', (dialog) => void dialog.accept());
  await cancelButton.click();
  await expectStatus(page, 'The authority was cancelled.');
  expect(cancels).toHaveLength(1);

  // An approved authority cancelled before service keeps its approved method.
  await page.goto(deepLink);
  await expect(record.getByRole('heading', { level: 2, name: approvedNo })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await cancelButton.click();
  await expectStatus(page, 'The authority was cancelled.');
  await expect(record).toContainText('Approved method');

  // A new authority's message says only what its outcome proves.
  const newNo = `OT-E2E-${stamp}-NEW`;
  const listOrCreate = /\/api\/v1\/agencies\/[^/]+\/overtime-authorities$/;
  const newForm = await fillDraft(preparer.page, newNo, '4');
  const saveNew = newForm.getByRole('button', { name: 'Save draft' });
  const notSaved = 'The new authority was not saved.';
  const unconfirmed =
    'The save could not be confirmed. Save again without changing anything to retry: if the first save went through, its number will be refused as already in use.';
  const notRefreshed = 'The register could not refresh.';
  const wentThrough = (authorityNo: string): string =>
    `The earlier save went through as ${authorityNo}, so saving again was refused as a duplicate number.`;
  const alerts = preparer.page.getByRole('alert');

  await preparer.page.route(listOrCreate, (route) => route.abort());
  await saveNew.click();
  await expect(
    alerts.filter({ hasText: `The register could not refresh. ${unconfirmed}` }),
  ).toBeVisible();
  await expect(alerts.filter({ hasText: notSaved })).toHaveCount(0);
  await preparer.page.unroute(listOrCreate);

  // A refusal proves nothing was created, so it refreshes nothing.
  const refusedMethods: string[] = [];
  await preparer.page.route(listOrCreate, (route) => {
    refusedMethods.push(route.request().method());
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'REFUSED', message: 'That number is taken.' } }),
    });
  });
  await saveNew.click();
  await expect(alerts.filter({ hasText: `${notSaved} That number is taken.` })).toBeVisible();
  expect(refusedMethods).toEqual(['POST']);
  await preparer.page.unroute(listOrCreate);

  await preparer.page.route(listOrCreate, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      : route.continue(),
  );
  await saveNew.click();
  await expect(preparerRecord.getByRole('heading', { level: 2, name: newNo })).toBeVisible();
  await expectStatus(preparer.page, 'The draft was saved, but the register could not refresh.');
  await expect(alerts.filter({ hasText: notSaved })).toHaveCount(0);
  await preparer.page.unroute(listOrCreate);

  // A POST that commits but answers 500: Save stays busy through the refresh, and saving again
  // from the same form is refused under the same number, saying the first save went through as
  // that number. The draft stays in the register under its own number.
  const lostNo = `OT-E2E-${stamp}-LOST`;
  const lostForm = await fillDraft(preparer.page, lostNo, '4');
  let releaseRefresh = (): void => undefined;
  await preparer.page.route(listOrCreate, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fetch();
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return;
    }
    await new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    await route.continue();
  });
  const refreshRequest = preparer.page.waitForRequest(
    (sent) => listOrCreate.test(sent.url()) && sent.method() === 'GET',
    { timeout: 15_000 },
  );
  await lostForm.getByRole('button', { name: 'Save draft' }).click();
  await refreshRequest;
  await expect(lostForm.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  releaseRefresh();
  await expect(alerts.filter({ hasText: unconfirmed })).toBeVisible();
  await expect(alerts.filter({ hasText: notRefreshed })).toHaveCount(0);
  await expect(alerts.filter({ hasText: notSaved })).toHaveCount(0);
  await expect(lostForm.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  await preparer.page.unroute(listOrCreate);
  await lostForm.getByRole('button', { name: 'Save draft' }).click();
  await expect(alerts.filter({ hasText: wentThrough(lostNo) })).toBeVisible();
  await expect(alerts.filter({ hasText: notSaved })).toHaveCount(0);
  await preparer.page.getByRole('tab', { name: 'Tree' }).click();
  await expect(preparer.page.getByRole('button', { name: lostNo, exact: true })).toBeVisible();

  // When the refresh after an unconfirmed save fails too, the refused retry refreshes the
  // register itself, so Tree shows the draft without a page reload.
  const goneNo = `OT-E2E-${stamp}-GONE`;
  const goneForm = await fillDraft(preparer.page, goneNo, '4');
  await preparer.page.route(listOrCreate, async (route) => {
    if (route.request().method() === 'POST') await route.fetch();
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });
  await goneForm.getByRole('button', { name: 'Save draft' }).click();
  await expect(alerts.filter({ hasText: `${notRefreshed} ${unconfirmed}` })).toBeVisible();
  await preparer.page.unroute(listOrCreate);
  await goneForm.getByRole('button', { name: 'Save draft' }).click();
  await expect(alerts.filter({ hasText: wentThrough(goneNo) })).toBeVisible();
  await expect(alerts.filter({ hasText: notRefreshed })).toHaveCount(0);
  await preparer.page.getByRole('tab', { name: 'Tree' }).click();
  await expect(preparer.page.getByRole('button', { name: goneNo, exact: true })).toBeVisible();

  // A refusal between an unconfirmed save and its retry proves only that it created nothing, so
  // the retry under the same number still says the first save went through.
  const slipNo = `OT-E2E-${stamp}-SLIP`;
  const slipForm = await fillDraft(preparer.page, slipNo, '4');
  const saveSlip = slipForm.getByRole('button', { name: 'Save draft' });
  await preparer.page.route(listOrCreate, async (route) => {
    if (route.request().method() === 'POST') await route.fetch();
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });
  await saveSlip.click();
  await expect(alerts.filter({ hasText: `${notRefreshed} ${unconfirmed}` })).toBeVisible();
  await preparer.page.unroute(listOrCreate);
  await preparer.page.route(listOrCreate, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'VALIDATION_FAILED', message: 'Purpose is too long.' },
          }),
        })
      : route.continue(),
  );
  await saveSlip.click();
  await expect(alerts.filter({ hasText: `${notSaved} Purpose is too long.` })).toBeVisible();
  await expect(alerts.filter({ hasText: 'went through' })).toHaveCount(0);
  await preparer.page.unroute(listOrCreate);
  await saveSlip.click();
  await expect(alerts.filter({ hasText: wentThrough(slipNo) })).toBeVisible();
  await expect(alerts.filter({ hasText: notSaved })).toHaveCount(0);
  await preparer.page.getByRole('tab', { name: 'Tree' }).click();
  await expect(preparer.page.getByRole('button', { name: slipNo, exact: true })).toBeVisible();

  // A fresh form, opened after leaving the last one, made no earlier attempt, so a used number is
  // only a refusal.
  const freshForm = await fillNewDraft(preparer.page, goneNo, '4');
  await freshForm.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    alerts.filter({
      hasText: `${notSaved} An Overtime Authority with this number already exists in the Agency.`,
    }),
  ).toBeVisible();
  await expect(alerts.filter({ hasText: 'went through' })).toHaveCount(0);

  // An Auditor can read but not create, so ?new=1 opens no prepare form.
  await withAdmin(async (admin) => {
    const auditor = await admin.role.findFirstOrThrow({
      where: { agencyId: null, code: 'internal_auditor', status: 'ACTIVE' },
    });
    await admin.membershipRole.updateMany({
      where: { membershipId: reviewer.membershipId, effectiveTo: null },
      data: { roleId: auditor.id },
    });
  });
  await reviewer.page.goto('/overtime-authorities?new=1');
  await expect(reviewer.page.getByRole('button', { name: approvedNo, exact: true })).toBeVisible();
  await expect(reviewer.page.getByRole('button', { name: 'New authority' })).toHaveCount(0);
  await expect(
    reviewer.page.getByRole('region', { name: 'Prepare Overtime Authority' }),
  ).toHaveCount(0);

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
