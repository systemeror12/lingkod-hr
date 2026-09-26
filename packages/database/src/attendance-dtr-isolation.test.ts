import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function adminClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url } } });
}

async function withContext<T>(
  client: PrismaClient,
  values: { agencyId: string; userId: string; membershipId: string; approvalTransition?: boolean },
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SELECT set_config('app.agency_id', '" +
        values.agencyId +
        "', true), set_config('app.user_id', '" +
        values.userId +
        "', true), set_config('app.membership_id', '" +
        values.membershipId +
        "', true), set_config('app.approval_transition', '" +
        (values.approvalTransition ? 'on' : 'off') +
        "', true)",
    );
    return work(transaction);
  });
}

it.skipIf(!enabled)(
  'isolates Finalized Daily Time Records by Agency and keeps them immutable',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = await adminClient();
    const suffix = String(Date.now()) + '-dtr';
    const agencies = await Promise.all(
      ['A', 'B'].map((label) =>
        admin.agency.create({
          data: {
            code: 'DTR-RLS-' + label + '-' + suffix,
            name: 'Daily Time Record RLS ' + label,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const agencyA = agencies[0]!;
    const agencyB = agencies[1]!;
    const user = await admin.user.create({
      data: {
        identityProvider: 'attendance-dtr-rls-e2e',
        externalSubject: 'attendance-dtr-' + suffix,
        emailNormalized: 'attendance-dtr-' + suffix + '@example.test',
        displayName: 'Daily Time Record RLS User',
        globalStatus: 'ACTIVE',
      },
    });
    const [membershipA, membershipB] = await Promise.all([
      admin.agencyMembership.create({
        data: { agencyId: agencyA.id, userId: user.id, status: 'ACTIVE' },
      }),
      admin.agencyMembership.create({
        data: { agencyId: agencyB.id, userId: user.id, status: 'ACTIVE' },
      }),
    ]);
    const reviewer = await admin.user.create({
      data: {
        identityProvider: 'attendance-dtr-rls-e2e',
        externalSubject: 'attendance-dtr-reviewer-' + suffix,
        emailNormalized: 'attendance-dtr-reviewer-' + suffix + '@example.test',
        displayName: 'Daily Time Record RLS Reviewer',
        globalStatus: 'ACTIVE',
      },
    });
    const reviewerMembership = await admin.agencyMembership.create({
      data: { agencyId: agencyA.id, userId: reviewer.id, status: 'ACTIVE' },
    });
    const employee = await admin.employee.create({
      data: {
        agencyId: agencyA.id,
        employeeNumber: 'DTR-' + suffix,
        legalName: 'Daily Time Record Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: 'attendance-dtr-' + suffix + '@example.test',
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membershipA.id,
        updatedByMembershipId: membershipA.id,
      },
    });
    const period = await admin.attendancePeriod.create({
      data: {
        agencyId: agencyA.id,
        code: 'DTR-RLS-' + suffix,
        dateFrom: new Date('2026-01-01'),
        dateTo: new Date('2026-01-31'),
        status: 'FINALIZED',
      },
    });
    const routeVersion = await withContext(
      app,
      {
        agencyId: agencyA.id,
        userId: user.id,
        membershipId: membershipA.id,
        approvalTransition: true,
      },
      (transaction) =>
        transaction.approvalRouteVersion.create({
          data: {
            agencyId: agencyA.id,
            routeCode: 'DTR-RLS-' + suffix,
            versionNo: 1,
            domain: 'ATTENDANCE',
            stepDefinition: { steps: [] },
            effectiveFrom: new Date('2026-01-01'),
            status: 'ACTIVE',
          },
        }),
    );
    const day = await admin.attendanceDay.create({
      data: {
        agencyId: agencyA.id,
        attendancePeriodId: period.id,
        employeeId: employee.id,
        workDate: new Date('2026-01-05'),
        dayClassification: 'SCHEDULED',
        status: 'APPROVED',
        ruleSnapshot: { fingerprint: 'a'.repeat(64) },
      },
    });
    const submission = await admin.employeeAttendanceSubmission.create({
      data: {
        agencyId: agencyA.id,
        attendancePeriodId: period.id,
        employeeId: employee.id,
        versionNo: 1,
        status: 'APPROVED',
        submittedByMembershipId: membershipA.id,
        submittedAt: new Date('2026-01-06T01:00:00.000Z'),
        reviewedByMembershipId: reviewerMembership.id,
        reviewedAt: new Date('2026-01-06T02:00:00.000Z'),
      },
    });
    await admin.employeeAttendanceSubmissionDay.create({
      data: {
        agencyId: agencyA.id,
        employeeAttendanceSubmissionId: submission.id,
        attendanceDayId: day.id,
      },
    });
    const periodVersion = await admin.attendancePeriodVersion.create({
      data: {
        agencyId: agencyA.id,
        attendancePeriodId: period.id,
        versionNo: 1,
        status: 'LOCKED',
        approvalRouteVersionId: routeVersion.id,
        submittedByMembershipId: membershipA.id,
        submittedAt: new Date('2026-01-06T02:00:00.000Z'),
        reviewedByMembershipId: reviewerMembership.id,
        reviewedAt: new Date('2026-01-06T03:00:00.000Z'),
        lockedByMembershipId: membershipA.id,
        lockedAt: new Date('2026-01-06T04:00:00.000Z'),
        reconciliation: { seed: true },
      },
    });
    await admin.attendancePeriodVersionDay.create({
      data: {
        agencyId: agencyA.id,
        attendancePeriodVersionId: periodVersion.id,
        employeeAttendanceSubmissionId: submission.id,
        attendanceDayId: day.id,
      },
    });
    const document = await admin.document.create({
      data: {
        agencyId: agencyA.id,
        documentType: 'DAILY_TIME_RECORD',
        classification: 'INTERNAL',
        status: 'APPROVED',
        createdByMembershipId: membershipA.id,
      },
    });
    const documentVersion = await admin.documentVersion.create({
      data: {
        agencyId: agencyA.id,
        documentId: document.id,
        versionNo: 1,
        storageKey: 'dtr-rls/' + suffix,
        contentHash: 'd'.repeat(64),
        mimeType: 'text/html',
        sizeBytes: 1,
        issuedAt: new Date('2026-01-06T04:00:00.000Z'),
        createdByMembershipId: membershipA.id,
      },
    });
    await admin.document.update({
      where: { id: document.id },
      data: { currentVersionId: documentVersion.id },
    });

    try {
      const created = await withContext(
        app,
        { agencyId: agencyA.id, userId: user.id, membershipId: membershipA.id },
        (transaction) =>
          transaction.dtrDocument.create({
            data: {
              agencyId: agencyA.id,
              attendancePeriodVersionId: periodVersion.id,
              employeeId: employee.id,
              predecessorDtrDocumentId: null,
              classification: 'ORIGINAL',
              outputType: 'PRINTABLE_SYSTEM_VIEW',
              documentVersionId: documentVersion.id,
              sourceManifest: { format: 'LINGKODHR_DTR_SYSTEM_VIEW_V1', days: [] },
              generatedAt: new Date('2026-01-06T04:00:05.000Z'),
            },
            select: { id: true },
          }),
      );

      const foreignRead = await withContext(
        app,
        { agencyId: agencyB.id, userId: user.id, membershipId: membershipB.id },
        (transaction) => transaction.dtrDocument.findMany(),
      );
      expect(foreignRead).toEqual([]);

      await expect(
        withContext(
          app,
          { agencyId: agencyB.id, userId: user.id, membershipId: membershipB.id },
          (transaction) =>
            transaction.dtrDocument.create({
              data: {
                agencyId: agencyA.id,
                attendancePeriodVersionId: periodVersion.id,
                employeeId: employee.id,
                predecessorDtrDocumentId: null,
                classification: 'ORIGINAL',
                outputType: 'PRINTABLE_SYSTEM_VIEW',
                documentVersionId: documentVersion.id,
                sourceManifest: { format: 'LINGKODHR_DTR_SYSTEM_VIEW_V1', days: [] },
                generatedAt: new Date('2026-01-06T04:00:06.000Z'),
              },
            }),
        ),
      ).rejects.toThrow();

      await expect(
        admin.dtrDocument.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: created.id } },
          data: { generatedAt: new Date() },
        }),
      ).rejects.toThrow(/immutable/i);
      await expect(
        admin.dtrDocument.delete({
          where: { agencyId_id: { agencyId: agencyA.id, id: created.id } },
        }),
      ).rejects.toThrow(/retained/i);
    } finally {
      await admin.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await transaction.dtrDocument.deleteMany({ where: { agencyId: agencyA.id } });
        await transaction.attendancePeriodVersionDay.deleteMany({
          where: { agencyId: agencyA.id },
        });
        await transaction.attendancePeriodVersion.deleteMany({ where: { agencyId: agencyA.id } });
        await transaction.employeeAttendanceSubmissionDay.deleteMany({
          where: { agencyId: agencyA.id },
        });
        await transaction.employeeAttendanceSubmission.deleteMany({
          where: { agencyId: agencyA.id },
        });
        await transaction.attendanceDay.deleteMany({ where: { agencyId: agencyA.id } });
        await transaction.attendancePeriod.deleteMany({ where: { agencyId: agencyA.id } });
        await transaction.documentVersion.deleteMany({ where: { agencyId: agencyA.id } });
        await transaction.document.updateMany({
          where: { agencyId: agencyA.id },
          data: { currentVersionId: null },
        });
        await transaction.document.deleteMany({ where: { agencyId: agencyA.id } });
        await transaction.approvalRouteVersion.deleteMany({ where: { agencyId: agencyA.id } });
        await transaction.employee.deleteMany({ where: { agencyId: agencyA.id } });
        await transaction.agencyMembership.deleteMany({
          where: { agencyId: { in: [agencyA.id, agencyB.id] } },
        });
        await transaction.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
        await transaction.user.deleteMany({ where: { externalSubject: { contains: suffix } } });
      });
      await app.$disconnect();
      await admin.$disconnect();
    }
  },
);
