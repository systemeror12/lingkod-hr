import { PrismaClient } from '@prisma/client';
import type { RequestContext } from '@lingkod-hr/auth';
import { expect, it, vi } from 'vitest';
import {
  approvalAuditWriter,
  ApprovalsService,
  type ApprovalCompletionHandler,
} from './approval.service';

const enabled = process.env.DATABASE_E2E === 'true';

function context(
  agencyId: string,
  userId: string,
  membershipId: string,
  permissions: string[],
  requestId: string,
): RequestContext {
  return {
    agencyId,
    userId,
    membershipId,
    requestId,
    primaryOrganizationUnitId: null,
    permissions: permissions.map((code) => ({ code, scopePolicy: 'AGENCY' })),
  };
}

it.skipIf(!enabled)(
  'resolves, snapshots, submits, completes, and audits an approval route',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    if (!runtimeUrl || !adminUrl)
      throw new Error('Runtime and administrative database URLs are required.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    const suffix = `${Date.now()}`;
    const agency = await admin.agency.create({
      data: {
        code: `APPROVAL-SERVICE-${suffix}`,
        name: 'Approval Service Agency',
        agencyType: 'NGA',
        status: 'ACTIVE',
      },
    });
    const requesterUser = await admin.user.create({
      data: {
        emailNormalized: `requester-${suffix}@example.test`,
        displayName: 'Approval Service Requester',
        globalStatus: 'ACTIVE',
      },
    });
    const reviewerUser = await admin.user.create({
      data: {
        emailNormalized: `reviewer-${suffix}@example.test`,
        displayName: 'Approval Service Reviewer',
        globalStatus: 'ACTIVE',
      },
    });
    const delegateUser = await admin.user.create({
      data: {
        emailNormalized: `delegate-${suffix}@example.test`,
        displayName: 'Approval Service Delegate',
        globalStatus: 'ACTIVE',
      },
    });
    const requesterMembership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: requesterUser.id, status: 'ACTIVE' },
    });
    const reviewerMembership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: reviewerUser.id, status: 'ACTIVE' },
    });
    const delegateMembership = await admin.agencyMembership.create({
      data: { agencyId: agency.id, userId: delegateUser.id, status: 'ACTIVE' },
    });
    const hrmoRole = await admin.role.findFirstOrThrow({
      where: { code: 'hrmo_administrator', agencyId: null },
    });
    await admin.membershipRole.create({
      data: {
        agencyId: agency.id,
        membershipId: reviewerMembership.id,
        roleId: hrmoRole.id,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const completion: ApprovalCompletionHandler = { complete: vi.fn(async () => undefined) };
    const service = new ApprovalsService(approvalAuditWriter, completion);
    const routeCode = `SERVICE_ROUTE_${suffix}`;
    const subjectId = '00000000-0000-4000-8000-000000000201';
    const requester = context(
      agency.id,
      requesterUser.id,
      requesterMembership.id,
      [
        'approvals.routes.create',
        'approvals.routes.activate',
        'approvals.requests.create',
        'approvals.requests.submit',
        'approvals.requests.cancel',
      ],
      `approval-service-requester-${suffix}`,
    );
    const reviewer = context(
      agency.id,
      reviewerUser.id,
      reviewerMembership.id,
      [],
      `approval-service-reviewer-${suffix}`,
    );
    try {
      const route = await service.createRoute(requester, {
        routeCode,
        domain: 'RECRUITMENT',
        versionNo: 1,
        effectiveFrom: '2026-01-01',
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'approvals.requests.approve',
              assignment: { kind: 'MEMBERSHIP', membershipId: reviewerMembership.id },
              requiresSeparateReview: true,
            },
          ],
        },
      });
      expect(route.status).toBe('DRAFT');
      const activeRoute = await service.activateRoute(
        requester,
        route.id,
        'The Agency approved this route for the Phase 6 checkpoint.',
      );
      expect(activeRoute.status).toBe('ACTIVE');

      const request = await service.createRequest(requester, {
        routeCode,
        subjectType: 'REQUEST_TO_FILL',
        subjectId,
        effectiveDate: '2026-09-01',
      });
      expect(request.status).toBe('PENDING');
      expect(request.route.id).toBe(activeRoute.id);
      expect(request.steps[0]).toMatchObject({
        assignedMembershipId: reviewerMembership.id,
        status: 'PENDING',
      });

      const submitted = await service.submit(requester, request.id);
      expect(submitted).toMatchObject({ status: 'IN_PROGRESS', currentStepNo: 1 });
      expect(submitted.steps[0]).toMatchObject({ status: 'ACTIVE' });

      const approved = await service.approve(
        reviewer,
        request.id,
        'The owning Recruitment service may now validate and apply this checkpoint.',
        'approval-approve-1',
      );
      expect(approved).toMatchObject({ status: 'APPROVED', completedAt: expect.any(String) });
      expect(approved.steps[0]).toMatchObject({ status: 'APPROVED' });
      expect(completion.complete).toHaveBeenCalledOnce();
      expect(completion.complete).toHaveBeenCalledWith(
        expect.anything(),
        reviewer,
        expect.objectContaining({ approvalRequestId: request.id, subjectId }),
      );
      await expect(
        service.approve(
          reviewer,
          request.id,
          'The owning Recruitment service may now validate and apply this checkpoint.',
          'approval-approve-1',
        ),
      ).resolves.toMatchObject({ id: request.id, status: 'APPROVED' });
      expect(completion.complete).toHaveBeenCalledOnce();

      const history = await service.history(
        context(
          agency.id,
          reviewerUser.id,
          reviewerMembership.id,
          ['approvals.requests.audit.read'],
          `history-${suffix}`,
        ),
        request.id,
      );
      expect(history?.events.map(({ action }) => action)).toEqual([
        'APPROVAL_REQUEST_CREATED',
        'APPROVAL_REQUEST_SUBMITTED',
        'APPROVAL_REQUEST_APPROVED',
      ]);

      const delegation = await admin.delegatedAuthority.create({
        data: {
          agencyId: agency.id,
          delegatorMembershipId: reviewerMembership.id,
          delegateMembershipId: delegateMembership.id,
          permissionCode: 'approvals.requests.approve',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2027-01-01T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      });
      const delegatedRequest = await service.createRequest(requester, {
        routeCode,
        subjectType: 'REQUEST_TO_FILL',
        subjectId: '00000000-0000-4000-8000-000000000203',
        effectiveDate: '2026-09-01',
      });
      await service.submit(requester, delegatedRequest.id);
      const delegated = await service.approve(
        context(agency.id, delegateUser.id, delegateMembership.id, [], `delegate-${suffix}`),
        delegatedRequest.id,
        'Approved under the effective delegated authority.',
      );
      expect(delegated).toMatchObject({
        status: 'APPROVED',
        steps: [{ decisions: [{ delegatedAuthorityId: delegation.id }] }],
      });

      await admin.delegatedAuthority.create({
        data: {
          agencyId: agency.id,
          delegatorMembershipId: reviewerMembership.id,
          delegateMembershipId: requesterMembership.id,
          permissionCode: 'approvals.requests.approve',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2027-01-01T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      });
      const selfDelegatedRequest = await service.createRequest(requester, {
        routeCode,
        subjectType: 'REQUEST_TO_FILL',
        subjectId: '00000000-0000-4000-8000-000000000204',
        effectiveDate: '2026-09-01',
      });
      await service.submit(requester, selfDelegatedRequest.id);
      await expect(
        service.approve(
          requester,
          selfDelegatedRequest.id,
          'The drafter must not approve through delegated authority.',
        ),
      ).rejects.toMatchObject({ code: 'APPROVAL_SEGREGATION_REQUIRED' });
      await service.approve(
        reviewer,
        selfDelegatedRequest.id,
        'Approved after the drafter was correctly prevented from reviewing.',
      );

      const returnedRequest = await service.createRequest(requester, {
        routeCode,
        subjectType: 'REQUEST_TO_FILL',
        subjectId: '00000000-0000-4000-8000-000000000202',
        effectiveDate: '2026-09-01',
      });
      await service.submit(requester, returnedRequest.id);
      const returned = await service.returnRequest(
        reviewer,
        returnedRequest.id,
        'The request needs a correction before review can continue.',
      );
      expect(returned.status).toBe('RETURNED');
      const cancelled = await service.cancel(
        requester,
        returnedRequest.id,
        'The drafter cancelled the returned request for correction.',
      );
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.steps[0]).toMatchObject({ status: 'SKIPPED' });

      const multiStepRouteCode = `SERVICE_ROUTE_MULTI_${suffix}`;
      const multiStepRoute = await service.createRoute(requester, {
        routeCode: multiStepRouteCode,
        domain: 'RECRUITMENT',
        versionNo: 1,
        effectiveFrom: '2026-01-01',
        stepDefinition: {
          steps: [
            {
              stepNo: 1,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'approvals.requests.approve',
              assignment: { kind: 'MEMBERSHIP', membershipId: reviewerMembership.id },
              requiresSeparateReview: true,
            },
            {
              stepNo: 2,
              stepMode: 'SEQUENTIAL',
              requiredPermission: 'approvals.requests.approve',
              assignment: { kind: 'MEMBERSHIP', membershipId: reviewerMembership.id },
              requiresSeparateReview: true,
            },
          ],
        },
      });
      await service.activateRoute(
        requester,
        multiStepRoute.id,
        'The Agency approved this multi-step route for the Phase 6 checkpoint.',
      );
      const multiStepRequest = await service.createRequest(requester, {
        routeCode: multiStepRouteCode,
        subjectType: 'REQUEST_TO_FILL',
        subjectId: '00000000-0000-4000-8000-000000000205',
        effectiveDate: '2026-09-01',
      });
      await service.submit(requester, multiStepRequest.id);
      const returnedMultiStep = await service.returnRequest(
        reviewer,
        multiStepRequest.id,
        'The first step needs a correction before review can continue.',
      );
      expect(returnedMultiStep).toMatchObject({ status: 'RETURNED', currentStepNo: 1 });
      expect(returnedMultiStep.steps[1]).toMatchObject({ status: 'PENDING' });
      const resubmitted = await service.submit(requester, multiStepRequest.id);
      expect(resubmitted).toMatchObject({ status: 'IN_PROGRESS', currentStepNo: 1 });
      expect(resubmitted.steps[0]).toMatchObject({ status: 'ACTIVE' });
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.approvalDecision.deleteMany({ where: { agencyId: agency.id } });
        await transaction.approvalStep.deleteMany({ where: { agencyId: agency.id } });
        await transaction.approvalRequest.deleteMany({ where: { agencyId: agency.id } });
        await transaction.approvalRouteVersion.deleteMany({ where: { agencyId: agency.id } });
        await transaction.auditEvent.deleteMany({ where: { agencyId: agency.id } });
      });
      await admin.delegatedAuthority.deleteMany({ where: { agencyId: agency.id } });
      await admin.membershipRole.deleteMany({ where: { agencyId: agency.id } });
      await admin.agencyMembership.deleteMany({ where: { agencyId: agency.id } });
      await admin.user.deleteMany({
        where: { id: { in: [requesterUser.id, reviewerUser.id, delegateUser.id] } },
      });
      await admin.agency.delete({ where: { id: agency.id } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
