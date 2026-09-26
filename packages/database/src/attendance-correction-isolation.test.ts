import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

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

async function adminClient(): Promise<PrismaClient> {
  const url = process.env.DATABASE_E2E_ADMIN_URL ?? process.env.DATABASE_MIGRATION_OWNER_URL;
  if (!url) throw new Error('A database owner URL is required for the integration test.');
  return new PrismaClient({ datasources: { db: { url } } });
}

it.skipIf(!enabled)(
  'isolates Attendance Corrections by Agency and keeps facts, evidence, and effects immutable',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = await adminClient();
    const suffix = String(Date.now()) + '-correction';
    const agencies = await Promise.all(
      ['A', 'B'].map((label) =>
        admin.agency.create({
          data: {
            code: 'COR-RLS-' + label + '-' + suffix,
            name: 'Attendance Correction RLS ' + label,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        identityProvider: 'attendance-correction-rls-e2e',
        externalSubject: 'attendance-correction-' + suffix,
        emailNormalized: 'attendance-correction-' + suffix + '@example.test',
        displayName: 'Attendance Correction RLS User',
        globalStatus: 'ACTIVE',
      },
    });
    const memberships = await Promise.all(
      agencies.map(({ id }) =>
        admin.agencyMembership.create({
          data: { agencyId: id, userId: user.id, status: 'ACTIVE' },
        }),
      ),
    );
    const agencyA = agencies[0];
    const agencyB = agencies[1];
    const membershipA = memberships[0];
    const membershipB = memberships[1];
    if (!agencyA || !agencyB || !membershipA || !membershipB) {
      throw new Error('Attendance Correction fixtures were not created.');
    }

    const employee = await admin.employee.create({
      data: {
        agencyId: agencyA.id,
        employeeNumber: 'EMP-' + suffix,
        legalName: 'Attendance Correction Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: 'attendance-correction-' + suffix + '@example.test',
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membershipA.id,
        updatedByMembershipId: membershipA.id,
      },
    });
    const foreignEmployee = await admin.employee.create({
      data: {
        agencyId: agencyB.id,
        employeeNumber: 'EMP-F-' + suffix,
        legalName: 'Foreign Attendance Correction Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'MALE',
        civilStatus: 'SINGLE',
        contactEmail: 'attendance-correction-f-' + suffix + '@example.test',
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membershipB.id,
        updatedByMembershipId: membershipB.id,
      },
    });
    const routeA = await withContext(
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
            routeCode: 'ATTENDANCE_CORRECTION',
            versionNo: 1,
            domain: 'ATTENDANCE',
            stepDefinition: { steps: [] },
            effectiveFrom: new Date('2020-01-01'),
            status: 'DRAFT',
          },
        }),
    );
    const routeB = await withContext(
      admin,
      {
        agencyId: agencyB.id,
        userId: user.id,
        membershipId: membershipB.id,
        approvalTransition: true,
      },
      (transaction) =>
        transaction.approvalRouteVersion.create({
          data: {
            agencyId: agencyB.id,
            routeCode: 'ATTENDANCE_CORRECTION',
            versionNo: 1,
            domain: 'ATTENDANCE',
            stepDefinition: { steps: [] },
            effectiveFrom: new Date('2020-01-01'),
            status: 'DRAFT',
          },
        }),
    );
    const targetId = '00000000-0000-4000-8000-000000000001';
    const contextA = {
      agencyId: agencyA.id,
      userId: user.id,
      membershipId: membershipA.id,
    };
    const correctionValues = {
      employeeId: employee.id,
      initiatedByMembershipId: membershipA.id,
      recordedByMembershipId: membershipA.id,
      targetType: 'ATTENDANCE_EVENT',
      requestedAction: 'VOID',
      targetId,
      status: 'DRAFT',
      reason: 'Duplicate manual event.',
      approvalRouteVersionId: routeA.id,
      impactPreview: { fingerprint: 'a'.repeat(64) },
      updatedAt: new Date(),
    };
    const foreignCorrection = await admin.attendanceCorrection.create({
      data: {
        ...correctionValues,
        agencyId: agencyB.id,
        employeeId: foreignEmployee.id,
        initiatedByMembershipId: membershipB.id,
        recordedByMembershipId: membershipB.id,
        approvalRouteVersionId: routeB.id,
      },
    });
    const correction = await withContext(app, contextA, (transaction) =>
      transaction.attendanceCorrection.create({
        data: { ...correctionValues, agencyId: agencyA.id },
      }),
    );

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.attendanceCorrection.findMany({ where: { id: foreignCorrection.id } }),
      ),
    ).resolves.toHaveLength(0);
    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.attendanceCorrection.findMany({ where: { id: correction.id } }),
      ),
    ).resolves.toHaveLength(1);

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.attendanceCorrection.create({
          data: {
            ...correctionValues,
            agencyId: agencyB.id,
            employeeId: foreignEmployee.id,
            initiatedByMembershipId: membershipB.id,
            recordedByMembershipId: membershipB.id,
            approvalRouteVersionId: routeB.id,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security|foreign key|violates/i);

    await expect(
      admin.attendanceCorrection.update({
        where: { agencyId_id: { agencyId: agencyA.id, id: correction.id } },
        data: { reason: 'Rewritten reason.' },
      }),
    ).rejects.toThrow('Attendance Correction facts are immutable');

    await expect(
      admin.attendanceCorrection.delete({
        where: { agencyId_id: { agencyId: agencyA.id, id: correction.id } },
      }),
    ).rejects.toThrow('Attendance Corrections are retained and cannot be deleted');

    const effect = await withContext(app, contextA, (transaction) =>
      transaction.attendanceCorrectionEffect.create({
        data: {
          agencyId: agencyA.id,
          attendanceCorrectionId: correction.id,
          effectAction: 'VOID',
          targetType: 'ATTENDANCE_EVENT',
          originalTargetId: targetId,
          appliedByMembershipId: membershipA.id,
          appliedAt: new Date(),
        },
      }),
    );
    await expect(
      admin.attendanceCorrectionEffect.update({
        where: { id: effect.id },
        data: { effectAction: 'ADD' },
      }),
    ).rejects.toThrow('Attendance Correction Effects are immutable');
    await expect(
      admin.attendanceCorrectionEffect.delete({ where: { id: effect.id } }),
    ).rejects.toThrow('Attendance Correction Effects are immutable');

    await expect(
      withContext(app, contextA, (transaction) =>
        transaction.attendanceCorrection.findMany({ where: { id: correction.id } }),
      ),
    ).resolves.toHaveLength(1);

    await admin.$disconnect();
    await app.$disconnect();
  },
);
