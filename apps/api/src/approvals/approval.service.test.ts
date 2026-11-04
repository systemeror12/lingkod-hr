import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it, vi } from 'vitest';
import {
  approvalCompletionHandler,
  ApprovalCompletionRegistry,
  ApprovalServiceError,
  ApprovalsService,
} from './approval.service';

// A transaction that only answers the subject-type read; tests that reach
// further than that belong in approval.integration.test.ts.
const transaction = vi.hoisted(() => ({
  approvalRequest: { findFirst: vi.fn() },
}));
vi.mock('@lingkod-hr/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lingkod-hr/database')>()),
  withDatabaseContext: (_context: unknown, work: (client: unknown) => unknown) => work(transaction),
}));

const agencyId = '00000000-0000-4000-8000-000000000001';
const membershipId = '00000000-0000-4000-8000-000000000002';
const subjectId = '00000000-0000-4000-8000-000000000003';

function context(permissions: RequestContext['permissions']): RequestContext {
  return {
    requestId: 'approval-service-test',
    userId: '00000000-0000-4000-8000-000000000004',
    agencyId,
    membershipId,
    primaryOrganizationUnitId: null,
    permissions,
  };
}

const createInput = {
  routeCode: 'RECRUITMENT_REQUEST_REVIEW',
  subjectId,
  subjectType: 'REQUEST_TO_FILL' as const,
};

it.each([
  ['routes', () => new ApprovalsService().listRoutes(context([])), 'APPROVAL_ROUTE_READ_FORBIDDEN'],
  [
    'requests',
    () => new ApprovalsService().listRequests(context([])),
    'APPROVAL_REQUEST_READ_FORBIDDEN',
  ],
  [
    'request creation',
    () => new ApprovalsService().createRequest(context([]), createInput),
    'APPROVAL_REQUEST_CREATE_FORBIDDEN',
  ],
] as const)('rechecks the %s permission before touching PostgreSQL', async (_, work, code) => {
  await expect(work()).rejects.toMatchObject({ code, statusCode: 403 });
});

it('rejects Recruitment-owned decisions from the generic approval service', async () => {
  await expect(
    new ApprovalsService().createRequest(
      context([{ code: 'approvals.requests.create', scopePolicy: 'AGENCY' }]),
      {
        ...createInput,
        subjectType: 'SELECTION_DECISION' as never,
      },
    ),
  ).rejects.toMatchObject({
    code: 'APPROVAL_DOMAIN_RECORD_FORBIDDEN',
    statusCode: 400,
  });
});

it('refuses to open an Overtime Authority request outside the Overtime module', async () => {
  await expect(
    new ApprovalsService().createRequest(
      context([{ code: 'approvals.requests.create', scopePolicy: 'AGENCY' }]),
      { routeCode: 'OVERTIME_AUTHORITY', subjectId, subjectType: 'OVERTIME_AUTHORITY' },
    ),
  ).rejects.toMatchObject({
    code: 'APPROVAL_DOMAIN_RECORD_FORBIDDEN',
    statusCode: 400,
  });
});

it.each(['OVERTIME_AUTHORITY', 'COC_EARNED_CERTIFICATE', 'CTO_REQUEST'])(
  'refuses to submit a %s request outside its owning module',
  async (subjectType) => {
    transaction.approvalRequest.findFirst.mockResolvedValueOnce({ subjectType });
    await expect(
      new ApprovalsService().submit(
        context([{ code: 'approvals.requests.submit', scopePolicy: 'AGENCY' }]),
        subjectId,
      ),
    ).rejects.toMatchObject({
      code: 'APPROVAL_DOMAIN_RECORD_FORBIDDEN',
      statusCode: 400,
    });
  },
);

it('refuses to decide a CTO Request outside its owning module', async () => {
  transaction.approvalRequest.findFirst.mockResolvedValueOnce({ subjectType: 'CTO_REQUEST' });
  await expect(
    new ApprovalsService().approve(
      context([{ code: 'approvals.requests.approve', scopePolicy: 'AGENCY' }]),
      subjectId,
    ),
  ).rejects.toMatchObject({
    code: 'APPROVAL_DOMAIN_RECORD_FORBIDDEN',
    statusCode: 400,
  });
});

it('uses typed errors for approval workflow failures', () => {
  expect(new ApprovalServiceError('message', 409, 'CODE')).toBeInstanceOf(Error);
});

it('requires a reason for returns and rejections before opening a transaction', async () => {
  const service = new ApprovalsService();
  await expect(service.returnRequest(context([]), subjectId, '   ')).rejects.toMatchObject({
    code: 'APPROVAL_DECISION_REASON_REQUIRED',
    statusCode: 400,
  });
  await expect(service.reject(context([]), subjectId, '')).rejects.toMatchObject({
    code: 'APPROVAL_DECISION_REASON_REQUIRED',
    statusCode: 400,
  });
});

it('fails closed when no owning domain completion handler is registered', async () => {
  await expect(
    approvalCompletionHandler.complete({} as never, context([]), {
      approvalRequestId: subjectId,
      agencyId,
      subjectType: 'REQUEST_TO_FILL',
      subjectId,
      routeVersionId: subjectId,
    }),
  ).rejects.toMatchObject({
    code: 'APPROVAL_COMPLETION_HANDLER_REQUIRED',
    statusCode: 409,
  });
});

it('rejects malformed approval list cursors before opening PostgreSQL', async () => {
  const service = new ApprovalsService();
  const readContext = context([
    { code: 'approvals.routes.read', scopePolicy: 'AGENCY' },
    { code: 'approvals.requests.read', scopePolicy: 'AGENCY' },
  ]);

  await expect(service.listRoutes(readContext, { cursor: 'not-a-cursor' })).rejects.toMatchObject({
    code: 'APPROVAL_CURSOR_INVALID',
    statusCode: 400,
  });
  await expect(service.listRequests(readContext, { cursor: 'not-a-cursor' })).rejects.toMatchObject(
    {
      code: 'APPROVAL_CURSOR_INVALID',
      statusCode: 400,
    },
  );
});

it('runs a cancel guard only for the subject type it was registered for', async () => {
  const registry = new ApprovalCompletionRegistry();
  registry.registerCancel('ATTENDANCE_CORRECTION', async () => {
    throw new ApprovalServiceError('Refused.', 409, 'CANCEL_REFUSED');
  });
  const request = (subjectType: string) => ({
    approvalRequestId: subjectId,
    agencyId,
    subjectType,
    subjectId,
    routeVersionId: subjectId,
  });
  const transaction = {} as never;
  await expect(
    registry.onCancel(transaction, context([]), request('ATTENDANCE_CORRECTION')),
  ).rejects.toMatchObject({ code: 'CANCEL_REFUSED' });
  await expect(
    registry.onCancel(transaction, context([]), request('LEAVE_APPLICATION')),
  ).resolves.toBeUndefined();
});
