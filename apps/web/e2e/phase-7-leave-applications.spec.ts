import { PrismaClient } from '@prisma/client';
import { getConfig } from '@lingkod-hr/config';
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
async function backdateReviewerRoleGrants(membershipId: string): Promise<void> {
  getConfig();
  const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!adminUrl)
    throw new Error('A worktree database owner URL is required for the reviewer fixture.');
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await admin.membershipRole.updateMany({
      where: { membershipId, effectiveTo: null },
      data: { effectiveFrom: new Date('2026-01-01T00:00:00+08:00') },
    });
  } finally {
    await admin.$disconnect();
  }
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
  await backdateReviewerRoleGrants(session.membershipId);
  return { page: reviewerPage, membershipId: session.membershipId };
}

test('submits, reviews, withdraws, and applies whole and partial cancellation from the protected Leave register', async ({
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
  await decision.getByLabel('Approve the full requested quantity').uncheck();
  await expect(decision).toContainText('Charges certified leave credits');
  await decision.getByLabel('Approved quantity').fill('2');
  await decision.getByRole('button', { name: 'Approve application' }).click();
  await expect(deciderDetail).toContainText('The Leave Application was approved.');
  await expect(deciderDetail).toContainText('APPROVED');
  await expect(deciderDetail).toContainText('Approved allocation');
  await expect(deciderDetail).toContainText('leave account 2 working day');

  // Request and decide a Leave Cancellation over the approved allocation.
  const cancellationRoute = await apiBody<{ id: string }>(
    await page.request.post(`${agencyBase}/approval-routes`, {
      headers,
      data: {
        routeCode: 'LEAVE_CANCELLATION',
        domain: 'leave',
        versionNo: 1,
        effectiveFrom: '2026-01-01',
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'leave.applications.cancel',
              approvePermission: 'leave.applications.cancel',
              rejectPermission: 'leave.applications.reject_cancel',
              assignment: { kind: 'MEMBERSHIP', membershipId: decider.membershipId },
              requiresSeparateReview: true,
            },
          ],
        },
      },
    }),
  );
  await apiBody(
    await page.request.post(`${agencyBase}/approval-routes/${cancellationRoute.id}/activate`, {
      headers,
      data: { reason: 'Leave Cancellation route verified for Leave Application coverage.' },
    }),
  );

  await page.goto(`/leave-applications?record=${reviewApplicationId}`);
  const requesterDetail = page.getByRole('region', { name: 'Alex Rivera', exact: true });
  await requesterDetail.getByRole('button', { name: 'Request cancellation' }).click();
  const cancelRequest = page.getByRole('region', { name: 'Request cancellation', exact: true });
  await cancelRequest.getByLabel('Cancellation scope').selectOption('PARTIAL');
  await cancelRequest.getByRole('checkbox', { name: /Cancel .* leave account/ }).check();
  await cancelRequest.getByLabel('Cancelled from').fill('2026-06-03');
  await cancelRequest.getByLabel('Cancelled to').fill('2026-06-03');
  await cancelRequest.getByLabel('Cancelled quantity').fill('1');
  await cancelRequest.getByLabel('Cancellation reason').fill('Return to duty on the last day.');
  await cancelRequest
    .getByLabel('Cancellation evidence Document ID (optional)')
    .fill(nationalRuleDocumentId);
  await cancelRequest.getByRole('button', { name: 'Submit cancellation request' }).click();
  await expect(requesterDetail).toContainText('The cancellation was requested.');
  await expect(requesterDetail).toContainText('CANCEL_REQUESTED');
  const requestedCancellation = requesterDetail.getByRole('article', {
    name: /Cancellation requested/,
  });
  await expect(requestedCancellation).toContainText('partial cancellation');
  await expect(requestedCancellation).toContainText('Decision requested');
  await expect(requestedCancellation).toContainText('Effect not ready');
  await expect(requestedCancellation).toContainText('leave account 1 working day');
  await expect(requestedCancellation).toContainText('Return to duty on the last day.');

  await decider.page.goto(`/leave-applications?record=${reviewApplicationId}`);
  const cancelDeciderDetail = decider.page.getByRole('region', {
    name: 'Alex Rivera',
    exact: true,
  });
  await cancelDeciderDetail.getByRole('button', { name: 'Reject cancellation' }).click();
  const rejectCancellation = decider.page.getByRole('region', { name: 'Decide the cancellation' });
  await rejectCancellation.getByLabel('Reason').fill('The leave remains needed for coverage.');
  await rejectCancellation.getByRole('button', { name: 'Reject cancellation' }).click();
  await expect(cancelDeciderDetail).toContainText('The cancellation was rejected.');
  const snapshot = cancelDeciderDetail.getByRole('region', { name: /^Alex Rivera · / });
  await expect(snapshot.getByText('APPROVED', { exact: true })).toBeVisible();
  await expect(
    cancelDeciderDetail.getByRole('article', { name: /Cancellation requested/ }),
  ).toContainText('Decision rejected');

  await page.goto(`/leave-applications?record=${reviewApplicationId}`);
  await requesterDetail.getByRole('button', { name: 'Request cancellation' }).click();
  const wholeRequest = page.getByRole('region', { name: 'Request cancellation', exact: true });
  await wholeRequest.getByLabel('Cancellation reason').fill('Leave no longer required.');
  await wholeRequest
    .getByLabel('Cancellation evidence Document ID (optional)')
    .fill(nationalRuleDocumentId);
  await wholeRequest.getByRole('button', { name: 'Submit cancellation request' }).click();
  await expect(requesterDetail).toContainText('The cancellation was requested.');

  await decider.page.goto(`/leave-applications?record=${reviewApplicationId}`);
  await cancelDeciderDetail.getByRole('button', { name: 'Approve cancellation' }).click();
  const approveCancellation = decider.page.getByRole('region', { name: 'Decide the cancellation' });
  await approveCancellation.getByRole('button', { name: 'Approve cancellation' }).click();
  await expect(cancelDeciderDetail).toContainText(
    'The cancellation was approved; its effects are pending.',
  );
  await expect(snapshot.getByText('CANCEL_REQUESTED', { exact: true })).toBeVisible();
  const approvedCancellation = cancelDeciderDetail
    .getByRole('article', { name: /Cancellation requested/ })
    .last();
  await expect(approvedCancellation).toContainText('whole cancellation');
  await expect(approvedCancellation).toContainText('Decision approved');
  await expect(approvedCancellation).toContainText('Effect pending');
  await expect(approvedCancellation).toContainText('no ledger, commitment, or Attendance change');
  await page.goto(`/leave-applications?record=${reviewApplicationId}`);
  const applyDetail = page.getByRole('region', { name: 'Alex Rivera', exact: true });
  await applyDetail.getByRole('button', { name: 'Apply cancellation', exact: true }).click();
  await expect(applyDetail).toContainText('The cancellation was applied.');
  await expect(applyDetail.getByText('CANCELLED', { exact: true })).toBeVisible();
  const appliedCancellation = applyDetail
    .getByRole('article', { name: /Cancellation requested/ })
    .last();
  await expect(appliedCancellation).toContainText('Effect applied');
  await expect(appliedCancellation).toContainText('Commitment released');
  await expect(appliedCancellation).not.toContainText(
    'no ledger, commitment, or Attendance change',
  );
  await page.reload();
  await expect(appliedCancellation).toContainText('Effect applied');
  await expect(
    applyDetail.getByRole('button', { name: 'Apply cancellation', exact: true }),
  ).toHaveCount(0);

  async function approveApplication(periods: Array<{ dateFrom: string; dateTo: string }>) {
    const partialApplication = await apiBody<{ application: { id: string } }>(
      await page.request.post(`${agencyBase}/leave-applications`, {
        headers,
        data: { employeeId: employee.id, leaveTypeId: leaveType.id },
      }),
    );
    const partialBase = `${agencyBase}/leave-applications/${partialApplication.application.id}`;
    await apiBody(
      await page.request.patch(partialBase, {
        headers,
        data: {
          reason: 'Two days of special privilege leave.',
          commutationChoice: 'NOT_REQUESTED',
          periods,
          documents: [
            { documentId: nationalRuleDocumentId, purposeCode: 'SIGNED_LEAVE_APPLICATION_FORM' },
          ],
        },
      }),
    );
    await apiBody(
      await page.request.post(`${partialBase}/submission`, {
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
    await apiBody(await page.request.post(`${partialBase}/routing`, { headers }));
    await apiBody(
      await certifier.page.request.post(`${partialBase}/certification`, { headers, data: {} }),
    );
    await apiBody(
      await decider.page.request.post(`${partialBase}/recommendation`, {
        headers,
        data: { outcome: 'RECOMMEND_APPROVAL' },
      }),
    );
    const partialApproved = await apiBody<{
      versions: Array<{ approvalAllocation: { lines: Array<{ id: string }> } }>;
    }>(
      await decider.page.request.post(`${partialBase}/decision`, {
        headers,
        data: { decision: 'APPROVE' },
      }),
    );
    return {
      application: partialApplication.application,
      base: partialBase,
      approved: partialApproved,
    };
  }
  const {
    application: partialApplication,
    base: partialBase,
    approved: partialApproved,
  } = await approveApplication([{ dateFrom: '2026-06-08', dateTo: '2026-06-09' }]);
  const partialRequested = await apiBody<{ cancellations: Array<{ id: string }> }>(
    await page.request.post(`${partialBase}/cancellation-requests`, {
      headers,
      data: {
        scopeType: 'PARTIAL',
        reason: 'Return to duty early.',
        evidenceDocumentId: nationalRuleDocumentId,
        scopes: [
          {
            allocationLineId: partialApproved.versions.at(-1)!.approvalAllocation.lines[0]!.id,
            dateFrom: '2026-06-09',
            dateTo: '2026-06-09',
            quantity: '1',
          },
        ],
      },
    }),
  );
  await apiBody(
    await decider.page.request.post(`${partialBase}/cancellation-decisions`, {
      headers,
      data: { decision: 'APPROVE' },
    }),
  );
  await page.goto(`/leave-applications?record=${partialApplication.id}`);
  const partialArticle = applyDetail.getByRole('article', { name: /Cancellation requested/ });
  await expect(partialArticle).toContainText('partial cancellation');
  const attemptKeys: Array<string | null> = [];
  const applyUrl = `**/leave-applications/${partialApplication.id}/cancellations/${partialRequested.cancellations[0]!.id}/apply`;
  await page.route(applyUrl, async (route) => {
    attemptKeys.push(route.request().headers()['idempotency-key'] ?? null);
    if (attemptKeys.length === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { message: 'Temporary connection failure. Retry the cancellation.' },
        }),
      });
    } else await route.continue();
  });
  await applyDetail.getByRole('button', { name: 'Apply cancellation', exact: true }).click();
  await expect(applyDetail).toContainText('Temporary connection failure. Retry the cancellation.');
  await expect(partialArticle).toContainText('Effect pending');
  await expect(applyDetail.getByText('CANCEL_REQUESTED', { exact: true })).toBeVisible();
  await applyDetail.getByRole('button', { name: 'Apply cancellation', exact: true }).click();
  await expect(partialArticle).toContainText('Effect applied');
  await expect(partialArticle).toContainText('Commitment released');
  await expect(applyDetail.getByText('CANCELLED', { exact: true })).toBeVisible();
  expect(attemptKeys).toEqual([
    `LEAVE_CANCELLATION_APPLY:${partialRequested.cancellations[0]!.id}`,
    `LEAVE_CANCELLATION_APPLY:${partialRequested.cancellations[0]!.id}`,
  ]);
  await page.unroute(applyUrl);
  const { application: postingApplication } = await approveApplication([
    { dateFrom: '2026-06-10', dateTo: '2026-06-10' },
  ]);
  const postingApplicationId = postingApplication.id;
  await decider.page.goto(`/leave-applications?record=${postingApplicationId}`);
  await expect(deciderDetail.getByRole('region', { name: 'Posting effects' })).toHaveCount(0);
  const approverPosting = await decider.page.request.post(
    `${agencyBase}/leave-applications/${postingApplicationId}/posting`,
    {
      headers: {
        origin: new URL(decider.page.url()).origin,
        'Idempotency-Key': 'posting-separation',
      },
      data: {},
    },
  );
  expect(approverPosting.status()).toBe(403);
  await certifier.page.goto(`/leave-applications?record=${postingApplicationId}`);
  await certifierDetail.getByRole('button', { name: 'Post leave' }).click();
  await expect(certifierDetail).toContainText(
    'The Leave Application was posted to Leave and Attendance.',
  );
  await expect(certifierDetail).toContainText('POSTED');
  const effects = certifierDetail.getByRole('region', { name: 'Posting effects' });
  await expect(effects).toContainText('Leave Ledger Entry');
  await expect(effects).toContainText('Attendance input');
  await expect(certifierDetail.getByRole('button', { name: 'Post leave' })).toHaveCount(0);
});
