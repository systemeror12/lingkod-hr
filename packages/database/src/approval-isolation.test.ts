import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  values: { agencyId: string; userId: string; membershipId: string; approvalTransition?: boolean },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.agency_id', ${values.agencyId}, true),
        set_config('app.user_id', ${values.userId}, true),
        set_config('app.membership_id', ${values.membershipId}, true),
        set_config('app.approval_transition', ${values.approvalTransition ? 'on' : ''}, true)
    `;
    return work(transaction);
  });
}

it.skipIf(!enabled)(
  'enforces approval snapshots, lifecycle guards, concurrency, audit, and RLS',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    const adminUrl = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
    if (!runtimeUrl || !adminUrl)
      throw new Error('Runtime and administrative database URLs are required.');

    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    const suffix = `${Date.now()}`;
    const agencies = await Promise.all(
      ['A', 'B'].map((label) =>
        admin.agency.create({
          data: {
            code: `APPROVAL-RLS-${label}-${suffix}`,
            name: `Approval RLS ${label}`,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const requesterUser = await admin.user.create({
      data: {
        emailNormalized: `requester-${suffix}@example.test`,
        displayName: 'Approval Requester',
        globalStatus: 'ACTIVE',
      },
    });
    const reviewerUser = await admin.user.create({
      data: {
        emailNormalized: `reviewer-${suffix}@example.test`,
        displayName: 'Approval Reviewer',
        globalStatus: 'ACTIVE',
      },
    });
    const requesterMemberships = await Promise.all(
      agencies.map(({ id }) =>
        admin.agencyMembership.create({
          data: { agencyId: id, userId: requesterUser.id, status: 'ACTIVE' },
        }),
      ),
    );
    const reviewerMembership = await admin.agencyMembership.create({
      data: { agencyId: agencies[0]!.id, userId: reviewerUser.id, status: 'ACTIVE' },
    });
    const hrmoRole = await admin.role.findFirstOrThrow({
      where: { code: 'hrmo_administrator', agencyId: null },
    });
    await admin.membershipRole.create({
      data: {
        agencyId: agencies[0]!.id,
        membershipId: reviewerMembership.id,
        roleId: hrmoRole.id,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const agencyA = agencies[0]!;
    const agencyB = agencies[1]!;
    const requesterA = requesterMemberships[0]!;
    const requesterB = requesterMemberships[1]!;
    const routeDefinition = {
      steps: [
        {
          stepNo: 1,
          stepMode: 'SEQUENTIAL',
          requiredPermission: 'approvals.requests.approve',
          assignment: { kind: 'MEMBERSHIP', membershipId: reviewerMembership.id },
          requiresSeparateReview: true,
        },
      ],
    };
    const subjectA = '00000000-0000-4000-8000-000000000101';
    const subjectB = '00000000-0000-4000-8000-000000000102';
    let requestId: string | undefined;
    let raceRequestId: string | undefined;
    let auditEventId: string | undefined;

    try {
      const routeA = await withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: requesterUser.id,
          membershipId: requesterA.id,
          approvalTransition: true,
        },
        (transaction) =>
          transaction.approvalRouteVersion.create({
            data: {
              agencyId: agencyA.id,
              routeCode: 'RECRUITMENT_REQUEST_REVIEW',
              versionNo: 1,
              domain: 'RECRUITMENT',
              stepDefinition: routeDefinition,
              effectiveFrom: new Date('2026-01-01'),
              status: 'ACTIVE',
            },
          }),
      );
      const routeB = await withContext(
        admin,
        {
          agencyId: agencyB.id,
          userId: requesterUser.id,
          membershipId: requesterB.id,
          approvalTransition: true,
        },
        (transaction) =>
          transaction.approvalRouteVersion.create({
            data: {
              agencyId: agencyB.id,
              routeCode: 'RECRUITMENT_REQUEST_REVIEW',
              versionNo: 1,
              domain: 'RECRUITMENT',
              stepDefinition: routeDefinition,
              effectiveFrom: new Date('2026-01-01'),
              status: 'ACTIVE',
            },
          }),
      );

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: requesterUser.id,
            membershipId: requesterA.id,
            approvalTransition: true,
          },
          (transaction) =>
            transaction.approvalRouteVersion.create({
              data: {
                agencyId: agencyB.id,
                routeCode: 'FOREIGN_ROUTE',
                versionNo: 1,
                domain: 'RECRUITMENT',
                stepDefinition: routeDefinition,
                effectiveFrom: new Date('2026-01-01'),
                status: 'DRAFT',
              },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: requesterUser.id,
            membershipId: requesterA.id,
            approvalTransition: true,
          },
          (transaction) =>
            transaction.approvalRouteVersion.create({
              data: {
                agencyId: agencyA.id,
                routeCode: 'RECRUITMENT_REQUEST_REVIEW',
                versionNo: 2,
                domain: 'RECRUITMENT',
                stepDefinition: routeDefinition,
                effectiveFrom: new Date('2026-01-01'),
                status: 'ACTIVE',
              },
            }),
        ),
      ).rejects.toThrow(/exclusion|overlap|23P01/i);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: requesterUser.id,
            membershipId: requesterA.id,
            approvalTransition: true,
          },
          (transaction) =>
            transaction.approvalRouteVersion.update({
              where: { agencyId_id: { agencyId: agencyA.id, id: routeA.id } },
              data: { domain: 'MUTATED' },
            }),
        ),
      ).rejects.toThrow(/immutable/i);

      const createRequest = (subjectId: string) =>
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: requesterUser.id,
            membershipId: requesterA.id,
            approvalTransition: true,
          },
          (transaction) =>
            transaction.approvalRequest.create({
              data: {
                agencyId: agencyA.id,
                routeVersionId: routeA.id,
                subjectType: 'REQUEST_TO_FILL',
                subjectId,
                requestedByMembershipId: requesterA.id,
                status: 'PENDING',
                steps: {
                  create: {
                    stepNo: 1,
                    stepMode: 'SEQUENTIAL',
                    requiredPermission: 'approvals.requests.approve',
                    approvePermission: 'approvals.requests.approve',
                    returnPermission: 'approvals.requests.approve',
                    rejectPermission: 'approvals.requests.approve',
                    assignedMembershipId: reviewerMembership.id,
                    status: 'PENDING',
                  },
                },
              },
              include: { steps: true },
            }),
        );

      const raceResults = await Promise.allSettled([
        createRequest(subjectA),
        createRequest(subjectA),
      ]);
      expect(raceResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(raceResults.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      const successfulRace = raceResults.find(
        (result): result is PromiseFulfilledResult<{ id: string }> => result.status === 'fulfilled',
      );
      raceRequestId = successfulRace?.value.id;
      expect(raceRequestId).toBeDefined();
      requestId = raceRequestId;

      const visibleForeignRoutes = await withContext(
        app,
        { agencyId: agencyA.id, userId: requesterUser.id, membershipId: requesterA.id },
        (transaction) => transaction.approvalRouteVersion.findMany({ where: { id: routeB.id } }),
      );
      expect(visibleForeignRoutes).toHaveLength(0);

      await expect(
        withContext(
          app,
          {
            agencyId: agencyA.id,
            userId: requesterUser.id,
            membershipId: requesterA.id,
            approvalTransition: true,
          },
          (transaction) =>
            transaction.approvalRequest.create({
              data: {
                agencyId: agencyB.id,
                routeVersionId: routeB.id,
                subjectType: 'REQUEST_TO_FILL',
                subjectId: subjectB,
                requestedByMembershipId: requesterB.id,
                status: 'PENDING',
              },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);

      const request = await withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: requesterUser.id,
          membershipId: requesterA.id,
          approvalTransition: true,
        },
        (transaction) =>
          transaction.approvalRequest.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: requestId! } },
            data: { status: 'IN_PROGRESS', currentStepNo: 1 },
            include: { steps: true },
          }),
      );
      const step = request.steps[0]!;
      await withContext(
        app,
        {
          agencyId: agencyA.id,
          userId: reviewerUser.id,
          membershipId: reviewerMembership.id,
          approvalTransition: true,
        },
        async (transaction) => {
          await transaction.approvalStep.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: step.id } },
            data: { status: 'ACTIVE', activatedAt: new Date() },
          });
          const decision = await transaction.approvalDecision.create({
            data: {
              agencyId: agencyA.id,
              approvalStepId: step.id,
              decidedByMembershipId: reviewerMembership.id,
              decision: 'APPROVE',
              comments: 'Approved in the PostgreSQL lifecycle test.',
              requestId: 'approval-db-test',
            },
          });
          auditEventId = (
            await transaction.auditEvent.create({
              data: {
                agencyId: agencyA.id,
                actorUserId: reviewerUser.id,
                actorMembershipId: reviewerMembership.id,
                actorType: 'USER',
                action: 'APPROVAL_REQUEST_APPROVED',
                entityType: 'ApprovalRequest',
                entityId: request.id,
                previousStatus: 'IN_PROGRESS',
                newStatus: 'APPROVED',
                requestId: 'approval-db-test',
                metadata: { comments: 'Approved in the PostgreSQL lifecycle test.' },
              },
            })
          ).id;
          await expect(
            transaction.approvalDecision.update({
              where: { id: decision.id },
              data: { comments: 'mutated' },
            }),
          ).rejects.toThrow(/immutable|permission denied/i);
          await expect(
            transaction.approvalDecision.delete({ where: { id: decision.id } }),
          ).rejects.toThrow(/immutable|permission denied/i);
        },
      );
      expect(auditEventId).toBeDefined();
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.approvalDecision.deleteMany({
          where: { agencyId: { in: agencies.map(({ id }) => id) } },
        });
        await transaction.approvalStep.deleteMany({
          where: { agencyId: { in: agencies.map(({ id }) => id) } },
        });
        await transaction.approvalRequest.deleteMany({
          where: { agencyId: { in: agencies.map(({ id }) => id) } },
        });
        await transaction.approvalRouteVersion.deleteMany({
          where: { agencyId: { in: agencies.map(({ id }) => id) } },
        });
        await transaction.auditEvent.deleteMany({
          where: { agencyId: { in: agencies.map(({ id }) => id) } },
        });
      });
      await admin.membershipRole.deleteMany({ where: { membershipId: reviewerMembership.id } });
      await admin.agencyMembership.deleteMany({
        where: { agencyId: { in: agencies.map(({ id }) => id) } },
      });
      await admin.user.deleteMany({ where: { id: { in: [requesterUser.id, reviewerUser.id] } } });
      await admin.agency.deleteMany({ where: { id: { in: agencies.map(({ id }) => id) } } });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
