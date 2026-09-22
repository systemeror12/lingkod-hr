import { execFileSync } from 'node:child_process';
import { expect, test, type APIResponse, type Browser, type Page } from '@playwright/test';

const nationalRuleDocumentId = '77777777-7777-4777-8777-777777777777';
const leaveRouteCode = 'LEAVE-SPECIAL-PRIVILEGE-ROUTE';
const reviewRouteCode = 'LEAVE-REVIEW-ROUTE';

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
      { intervals: [100], timeout: 2_000 },
    )
    .toBe(true);
  if (!messageId) throw new Error('The invitation message did not arrive in Mailpit.');
  const detailResponse = await fetch(`http://localhost:8025/api/v1/message/${messageId}`);
  if (!detailResponse.ok) throw new Error('Mailpit message lookup failed.');
  return ((await detailResponse.json()) as { Text: string }).Text;
}

// Invitation role grants take effect at the activation instant, while Approval
// Route assignment resolution evaluates roles at 12:00 UTC of the submission
// date. Backdate the fixture grants so a same-day review flow resolves.
function backdateReviewerRoleGrants(membershipId: string): void {
  const adminUrl =
    process.env.DATABASE_E2E_ADMIN_URL ??
    process.env.DATABASE_MIGRATION_OWNER_URL ??
    'postgresql://hris_local:local_only@localhost:55432/hris';
  execFileSync(
    'psql',
    [
      adminUrl,
      '-XAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `UPDATE membership_roles SET effective_from = '2026-01-01T00:00:00+08:00' WHERE membership_id = '${membershipId}' AND effective_to IS NULL;`,
    ],
    { encoding: 'utf8' },
  );
}

async function inviteReviewer(
  browser: Browser,
  page: Page,
  email: string,
): Promise<{ page: Page; membershipId: string }> {
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
  const activationUrl =
    /https?:\/\/[^\s]+\/api\/v1\/auth\/invitations\/[A-Za-z0-9_-]{43}\/activate/.exec(
      mailText,
    )?.[0];
  if (!activationUrl)
    throw new Error('The reviewer invitation email did not contain an activation link.');
  const context = await browser.newContext();
  const reviewerPage = await context.newPage();
  await reviewerPage.goto(activationUrl);
  await reviewerPage.getByRole('link', { name: 'Continue to secure sign-in' }).click();
  await expect(reviewerPage).toHaveURL(/\/dashboard$/);
  const session = await apiBody<{ membershipId: string }>(
    await reviewerPage.request.get('/api/v1/auth/me', {
      headers: { origin: new URL(reviewerPage.url()).origin },
    }),
  );
  backdateReviewerRoleGrants(session.membershipId);
  return { page: reviewerPage, membershipId: session.membershipId };
}

test('prepares, checks eligibility, submits, and withdraws a Leave Application from the protected register', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
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
      data: { catalogueCode: 'SPECIAL_PRIVILEGE_LEAVE' },
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
        reason: 'Activating Special Privilege Leave for Leave Application coverage.',
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
  await detail.getByLabel('Commutation').selectOption('NOT_REQUESTED');
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

  const certifier = await inviteReviewer(
    browser,
    page,
    `leave-certifier-${Date.now()}@example.test`,
  );
  const decider = await inviteReviewer(browser, page, `leave-decider-${Date.now()}@example.test`);

  const reviewVersion = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/leave-types/${leaveType.id}/policy-versions`, {
      headers,
      data: {
        effectiveDate: '2026-02-01',
        approvalRouteCode: reviewRouteCode,
        applicability: { profiles: ['ORDINARY_CIVILIAN_NGA'] },
        documentRequirements: {},
        reason: 'Adopting the three-step review route for Leave Application coverage.',
      },
    }),
  );
  await apiBody(
    await page.request.post(
      `${agencyBase}/leave-types/${leaveType.id}/policy-versions/${reviewVersion.id}/authorities`,
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
      `${agencyBase}/leave-types/${leaveType.id}/policy-versions/${reviewVersion.id}/activate`,
      { headers, data: { reason: 'National rule verified for the Agency.' } },
    ),
  );
  const reviewRoute = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/approval-routes`, {
      headers,
      data: {
        routeCode: reviewRouteCode,
        domain: 'leave',
        versionNo: 1,
        effectiveFrom: '2026-02-01',
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'leave.credits.certify',
              assignment: { kind: 'MEMBERSHIP', membershipId: certifier.membershipId },
              requiresSeparateReview: true,
            },
            {
              stepNo: 2,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'leave.applications.recommend',
              assignment: { kind: 'MEMBERSHIP', membershipId: decider.membershipId },
              requiresSeparateReview: true,
            },
            {
              stepNo: 3,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'leave.applications.approve',
              assignment: { kind: 'MEMBERSHIP', membershipId: decider.membershipId },
              requiresSeparateReview: true,
            },
          ],
        },
      },
    }),
  );
  await apiBody(
    await page.request.post(`${agencyBase}/approval-routes/${reviewRoute.id}/activate`, {
      headers,
      data: { reason: 'Three-step review route verified for Leave Application coverage.' },
    }),
  );
  await apiBody(
    await page.request.post(`${agencyBase}/leave-accounts`, {
      headers,
      data: {
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        effectiveDate: '2026-02-01',
        openingQuantity: 5,
        evidenceDocumentId: nationalRuleDocumentId,
        reason: 'Opening Special Privilege Leave credits for the review flow.',
      },
    }),
  );
  const reviewApplication = await apiBody<{ application: { id: string } }>(
    await page.request.post(`${agencyBase}/leave-applications`, {
      headers,
      data: { employeeId: employee.id, leaveTypeId: leaveType.id },
    }),
  );
  const reviewApplicationId = reviewApplication.application.id;
  await apiBody(
    await page.request.patch(`${agencyBase}/leave-applications/${reviewApplicationId}`, {
      headers,
      data: {
        reason: 'Special privilege leave for the review flow.',
        commutationChoice: 'NOT_REQUESTED',
        periods: [{ dateFrom: '2026-06-01', dateTo: '2026-06-03' }],
        documents: [
          { documentId: nationalRuleDocumentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
        ],
      },
    }),
  );
  await apiBody(
    await page.request.post(`${agencyBase}/leave-applications/${reviewApplicationId}/submission`, {
      headers,
      data: {
        formTemplateDocumentVersionId: formTemplate.version.id,
        attestation: {
          type: 'SIGNED_DOCUMENT',
          documentId: nationalRuleDocumentId,
          receivedAt: '2026-06-01T09:00:00.000+08:00',
        },
      },
    }),
  );

  await page.goto(`/leave-applications?record=${reviewApplicationId}`);
  const reviewDetail = page.getByRole('region', { name: 'Alex Rivera', exact: true });
  await expect(reviewDetail).toContainText('SUBMITTED');
  await reviewDetail.getByRole('button', { name: 'Send for certification' }).click();
  const routing = page.getByRole('region', { name: 'Send for credit certification' });
  await routing.getByRole('button', { name: 'Send for certification' }).click();
  await expect(reviewDetail).toContainText(
    'The Leave Application was sent for credit certification.',
  );
  await expect(reviewDetail).toContainText('FOR_CERTIFICATION');

  await certifier.page.goto(`/leave-applications?record=${reviewApplicationId}`);
  const certifierDetail = certifier.page.getByRole('region', {
    name: 'Alex Rivera',
    exact: true,
  });
  await certifierDetail.getByRole('button', { name: 'Certify credits' }).click();
  const certification = certifier.page.getByRole('region', { name: 'Certify leave credits' });
  await certification.getByRole('button', { name: 'Certify credits' }).click();
  await expect(certifierDetail).toContainText('The leave credits were certified.');
  await expect(certifierDetail).toContainText('FOR_RECOMMENDATION');
  const certifiedRow = certifierDetail
    .getByRole('row')
    .filter({ hasText: 'SPECIAL_PRIVILEGE_LEAVE' });
  await expect(certifiedRow).toContainText('5');
  await expect(certifiedRow).toContainText('3');
  await expect(certifiedRow).toContainText('2');

  await decider.page.goto(`/leave-applications?record=${reviewApplicationId}`);
  const deciderDetail = decider.page.getByRole('region', { name: 'Alex Rivera', exact: true });
  await deciderDetail.getByRole('button', { name: 'Recommend' }).click();
  const recommendation = decider.page.getByRole('region', {
    name: 'Recommend the Leave Application',
  });
  await recommendation.getByRole('button', { name: 'Record recommendation' }).click();
  await expect(deciderDetail).toContainText('The recommendation was recorded.');
  await expect(deciderDetail).toContainText('FOR_APPROVAL');

  await deciderDetail.getByRole('button', { name: 'Approve' }).click();
  const decision = decider.page.getByRole('region', { name: 'Record the final decision' });
  await decision.getByRole('button', { name: 'Approve application' }).click();
  await expect(deciderDetail).toContainText('The Leave Application was approved.');
  await expect(deciderDetail).toContainText('APPROVED');
  await expect(deciderDetail).toContainText('Approved allocation');
});
