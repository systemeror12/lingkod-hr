import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators';
import { ApprovalController } from './approval.controller';
import { ApprovalServiceError } from './approval.service';

const agencyId = '00000000-0000-4000-8000-000000000001';
const otherAgencyId = '00000000-0000-4000-8000-000000000002';
const requestId = '00000000-0000-4000-8000-000000000003';
const context: RequestContext = {
  requestId: 'approval-controller-test',
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId,
  membershipId: '00000000-0000-4000-8000-000000000005',
  primaryOrganizationUnitId: null,
  permissions: [{ code: 'approvals.requests.create', scopePolicy: 'AGENCY' }],
};

function serviceMock() {
  return {
    listRoutes: vi.fn(),
    findRoute: vi.fn(),
    createRoute: vi.fn(),
    activateRoute: vi.fn(),
    supersedeRoute: vi.fn(),
    listRequests: vi.fn(),
    createRequest: vi.fn(),
    findRequest: vi.fn(),
    history: vi.fn(),
    submit: vi.fn(),
    approve: vi.fn(),
    returnRequest: vi.fn(),
    reject: vi.fn(),
    cancel: vi.fn(),
  };
}

it('treats a foreign Agency approval request as absent', async () => {
  const service = serviceMock();
  const controller = new ApprovalController(service as never);

  await expect(controller.findRequest(otherAgencyId, requestId, context)).rejects.toMatchObject({
    status: 404,
    response: { error: { code: 'APPROVAL_NOT_FOUND', requestId: context.requestId } },
  });
  expect(service.findRequest).not.toHaveBeenCalled();
});

it('rejects Board Recommendations before the generic service is called', async () => {
  const service = serviceMock();
  const controller = new ApprovalController(service as never);

  await expect(
    controller.createRequest(
      agencyId,
      {
        routeCode: 'RECRUITMENT_REQUEST_REVIEW',
        subjectType: 'BOARD_RECOMMENDATION',
        subjectId: requestId,
      },
      context,
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(service.createRequest).not.toHaveBeenCalled();
});

it('forwards approval decisions with their public comments', async () => {
  const service = serviceMock();
  service.approve.mockResolvedValue({ id: requestId, status: 'APPROVED' });
  service.returnRequest.mockResolvedValue({ id: requestId, status: 'RETURNED' });
  const controller = new ApprovalController(service as never);

  await expect(
    controller.approve(agencyId, requestId, { comments: 'Approved.' }, context),
  ).resolves.toMatchObject({
    status: 'APPROVED',
  });
  await expect(
    controller.returnRequest(agencyId, requestId, { comments: 'Add authority evidence.' }, context),
  ).resolves.toMatchObject({ status: 'RETURNED' });
  expect(service.approve).toHaveBeenCalledWith(context, requestId, 'Approved.', undefined);
  expect(service.returnRequest).toHaveBeenCalledWith(
    context,
    requestId,
    'Add authority evidence.',
    undefined,
  );
});

it('keeps dynamic step decisions out of static controller permission metadata', () => {
  for (const method of ['approve', 'returnRequest', 'reject', 'cancel', 'submit'] as const) {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS, ApprovalController.prototype[method]),
    ).toBeUndefined();
  }
});

it('keeps service errors in the request envelope', async () => {
  const service = serviceMock();
  service.createRequest.mockRejectedValue(
    new ApprovalServiceError('No active route applies.', 409, 'APPROVAL_ROUTE_RESOLUTION_FAILED'),
  );
  const controller = new ApprovalController(service as never);

  await expect(
    controller.createRequest(
      agencyId,
      {
        routeCode: 'RECRUITMENT_REQUEST_REVIEW',
        subjectType: 'REQUEST_TO_FILL',
        subjectId: requestId,
      },
      context,
    ),
  ).rejects.toMatchObject({
    status: 409,
    response: { error: { code: 'APPROVAL_ROUTE_RESOLUTION_FAILED', requestId: context.requestId } },
  });
});
