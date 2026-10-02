import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';

const enabled = process.env.DATABASE_E2E === 'true';

async function withContext<T>(
  client: PrismaClient,
  values: { agencyId: string; userId: string; membershipId: string },
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
  'isolates Attendance Contexts by Agency and keeps them append-only',
  async () => {
    const runtimeUrl = process.env.DATABASE_URL;
    if (!runtimeUrl) throw new Error('DATABASE_URL is required for the integration test.');
    const app = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
    const admin = await adminClient();
    const suffix = String(Date.now()) + '-context';
    const agencies = await Promise.all(
      ['A', 'B'].map((label) =>
        admin.agency.create({
          data: {
            code: 'CTX-RLS-' + label + '-' + suffix,
            name: 'Attendance Context RLS ' + label,
            agencyType: 'NGA',
            status: 'ACTIVE',
          },
        }),
      ),
    );
    const user = await admin.user.create({
      data: {
        emailNormalized: 'attendance-context-' + suffix + '@example.test',
        displayName: 'Attendance Context RLS User',
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
      throw new Error('Attendance Context fixtures were not created.');
    }

    const employee = await admin.employee.create({
      data: {
        agencyId: agencyA.id,
        employeeNumber: 'EMP-' + suffix,
        legalName: 'Attendance Context RLS Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'FEMALE',
        civilStatus: 'SINGLE',
        contactEmail: 'attendance-context-' + suffix + '@example.test',
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membershipA.id,
        updatedByMembershipId: membershipA.id,
      },
    });
    const foreignEmployee = await admin.employee.create({
      data: {
        agencyId: agencyB.id,
        employeeNumber: 'EMP-F-' + suffix,
        legalName: 'Foreign Attendance Context Employee',
        birthDate: new Date('1990-01-01'),
        sex: 'MALE',
        civilStatus: 'SINGLE',
        contactEmail: 'attendance-context-f-' + suffix + '@example.test',
        serviceStatus: 'ACTIVE',
        createdByMembershipId: membershipB.id,
        updatedByMembershipId: membershipB.id,
      },
    });
    const contextA = {
      agencyId: agencyA.id,
      userId: user.id,
      membershipId: membershipA.id,
    };
    const hold = {
      employeeId: employee.id,
      contextType: 'OFFICIAL_BUSINESS',
      coverageMode: 'WHOLE_WORK_DATE',
      workDate: new Date('2026-01-05'),
      reason: 'Field validation in the municipality.',
      sourceType: 'TravelOrder',
      sourceId: '00000000-0000-4000-8000-000000000099',
      enteredByMembershipId: membershipA.id,
    };
    const foreignHold = await admin.attendanceContext.create({
      data: {
        ...hold,
        agencyId: agencyB.id,
        employeeId: foreignEmployee.id,
        enteredByMembershipId: membershipB.id,
      },
    });
    const holdA = await withContext(app, contextA, (transaction) =>
      transaction.attendanceContext.create({
        data: { ...hold, agencyId: agencyA.id },
      }),
    );

    try {
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.attendanceContext.findMany({ where: { id: foreignHold.id } }),
        ),
      ).resolves.toHaveLength(0);
      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.attendanceContext.findMany({ where: { id: holdA.id } }),
        ),
      ).resolves.toHaveLength(1);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.attendanceContext.create({
            data: {
              ...hold,
              agencyId: agencyB.id,
              employeeId: foreignEmployee.id,
              enteredByMembershipId: membershipB.id,
            },
          }),
        ),
      ).rejects.toThrow(/row-level security|foreign key|violates/i);

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.attendanceContext.update({
            where: { agencyId_id: { agencyId: agencyA.id, id: holdA.id } },
            data: { reason: 'Rewritten reason.' },
          }),
        ),
      ).rejects.toThrow();

      await expect(
        withContext(app, contextA, (transaction) =>
          transaction.attendanceContext.delete({
            where: { agencyId_id: { agencyId: agencyA.id, id: holdA.id } },
          }),
        ),
      ).rejects.toThrow();

      await expect(
        admin.attendanceContext.update({
          where: { agencyId_id: { agencyId: agencyA.id, id: holdA.id } },
          data: { reason: 'Rewritten reason.' },
        }),
      ).rejects.toThrow('Attendance Contexts are immutable');

      await expect(
        admin.attendanceContext.delete({
          where: { agencyId_id: { agencyId: agencyA.id, id: holdA.id } },
        }),
      ).rejects.toThrow('Attendance Contexts are retained and cannot be deleted');

      await expect(
        admin.attendanceContext.findFirstOrThrow({ where: { id: holdA.id } }),
      ).resolves.toMatchObject({ reason: 'Field validation in the municipality.' });
    } finally {
      await admin.$disconnect();
      await app.$disconnect();
    }
  },
);
